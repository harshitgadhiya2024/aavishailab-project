//! Batched, async activity reporting — a port of Python's
//! `ActivityReporter`, validated against the same behavioral spec as
//! scripts/agent/tests/test_activity_reporter.py. Queues events in memory
//! and uploads them in small batches on a background task, so reporting
//! never adds latency to the request the employee is actually waiting on.

use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const ACTIVITY_DEDUP_WINDOW: Duration = Duration::from_secs(8);
pub const ACTIVITY_MAX_QUEUE: usize = 2000;

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub event_type: String,
    pub action: String,
    pub target: String,
    pub target_domain: String,
    pub category: String,
    pub policy_name: String,
    pub risk_score: i64,
    pub timestamp: String,
}

pub struct ActivityReporter {
    client: AgentClient,
    gate: Arc<EnforcementGate>,
    queue: Mutex<VecDeque<Event>>,
    recent: Mutex<HashMap<(String, String), Instant>>,
}

/// Anything callers pass as the "matched rule" context for an event —
/// domain rule or threat-intel verdict, both carry the same three fields.
pub trait RuleLike {
    fn category(&self) -> &str;
    fn reason(&self) -> &str;
    fn risk_score(&self) -> i64;
}

impl ActivityReporter {
    pub fn new(client: AgentClient, gate: Arc<EnforcementGate>) -> Self {
        ActivityReporter { client, gate, queue: Mutex::new(VecDeque::new()), recent: Mutex::new(HashMap::new()) }
    }

    /// Dropped, not queued, if off-hours: an event captured after the
    /// working day ended must never be uploaded later.
    pub fn record(&self, target_url: &str, domain: &str, action: &str, rule: Option<&dyn RuleLike>, event_type: &str, kind: &str) {
        if !self.gate.logs(kind) {
            return;
        }

        let mut canonical = domain.to_lowercase();
        if let Some(s) = canonical.strip_prefix("www.") {
            canonical = s.to_string();
        }

        let now = Instant::now();
        let key = (canonical.clone(), action.to_string());
        let mut recent = self.recent.lock().unwrap();
        if let Some(last) = recent.get(&key) {
            if now.duration_since(*last) < ACTIVITY_DEDUP_WINDOW {
                return; // same site+outcome fired again almost instantly
            }
        }
        recent.insert(key, now);
        if recent.len() > 512 {
            let cutoff = now - ACTIVITY_DEDUP_WINDOW;
            recent.retain(|_, v| *v >= cutoff);
        }
        drop(recent);

        let event = Event {
            event_type: event_type.to_string(),
            action: action.to_string(),
            target: target_url.to_string(),
            target_domain: canonical,
            category: rule.map(|r| r.category().to_string()).unwrap_or_default(),
            policy_name: rule.map(|r| r.reason().to_string()).unwrap_or_default(),
            risk_score: rule.map(|r| r.risk_score()).unwrap_or(0),
            timestamp: crate::rfc3339::now_string(),
        };
        self.queue.lock().unwrap().push_back(event);
    }

    pub async fn loop_flush(self: Arc<Self>, interval: Duration) {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            self.flush().await;
        }
    }

    async fn flush(&self) {
        let batch: Vec<Event> = {
            let mut queue = self.queue.lock().unwrap();
            if queue.is_empty() {
                return;
            }
            queue.drain(..).collect()
        };

        if let Err(e) = self.client.post_json("/internal/agent/activity", &batch).await {
            tracing::debug!(error = %e, count = batch.len(), "activity report failed — requeuing");
            let mut queue = self.queue.lock().unwrap();
            for event in batch.into_iter().rev() {
                queue.push_front(event);
            }
            while queue.len() > ACTIVITY_MAX_QUEUE {
                queue.pop_back();
            }
        }
    }

    #[cfg(test)]
    pub fn queue_len(&self) -> usize {
        self.queue.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reporter() -> ActivityReporter {
        let client = AgentClient::new(crate::config::test_config(), Default::default());
        ActivityReporter::new(client, Arc::new(EnforcementGate::default()))
    }

    #[test]
    fn test_records_a_single_event() {
        let r = reporter();
        r.record("https://example.com/", "example.com", "allowed", None, "web_request", "activity");
        assert_eq!(r.queue_len(), 1);
    }

    #[test]
    fn test_dedup_window_collapses_rapid_repeats() {
        let r = reporter();
        r.record("https://example.com/a", "example.com", "allowed", None, "web_request", "activity");
        r.record("https://example.com/b", "example.com", "allowed", None, "web_request", "activity");
        r.record("https://example.com/c", "example.com", "allowed", None, "web_request", "activity");
        assert_eq!(r.queue_len(), 1);
    }

    #[test]
    fn test_different_action_is_not_deduped() {
        let r = reporter();
        r.record("https://example.com/a", "example.com", "allowed", None, "web_request", "activity");
        r.record("https://example.com/b", "example.com", "blocked", None, "web_request", "activity");
        assert_eq!(r.queue_len(), 2);
    }

    #[test]
    fn test_dedup_key_ignores_www_prefix() {
        let r = reporter();
        r.record("https://example.com/", "example.com", "allowed", None, "web_request", "activity");
        r.record("https://www.example.com/", "www.example.com", "allowed", None, "web_request", "activity");
        assert_eq!(r.queue_len(), 1);
    }

    #[test]
    fn test_off_hours_activity_event_is_dropped_not_queued() {
        let r = reporter();
        r.gate.apply(&crate::enforcement::EnforcementPayload { mode: Some("security_only".to_string()), active: None, reason: None, until: None, source: None }, None);
        r.record("https://example.com/", "example.com", "allowed", None, "web_request", "activity");
        assert_eq!(r.queue_len(), 0);
    }

    #[test]
    fn test_off_hours_security_event_is_still_queued() {
        let r = reporter();
        r.gate.apply(&crate::enforcement::EnforcementPayload { mode: Some("security_only".to_string()), active: None, reason: None, until: None, source: None }, None);
        r.record("https://evil.com/", "evil.com", "blocked", None, "web_request", "security");
        assert_eq!(r.queue_len(), 1);
    }

    #[test]
    fn test_paused_drops_everything_including_security() {
        let r = reporter();
        r.gate.apply(&crate::enforcement::EnforcementPayload { mode: Some("paused".to_string()), active: None, reason: None, until: None, source: None }, None);
        r.record("https://evil.com/", "evil.com", "blocked", None, "web_request", "security");
        assert_eq!(r.queue_len(), 0);
    }
}
