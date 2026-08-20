//! RFC3339 parsing for the working-hours deadline — a port of Python's
//! `_parse_rfc3339`/`_seconds_between`, validated against the same
//! behavioral spec as scripts/agent/tests/test_rfc3339.py.
//!
//! Unlike the Python original, this doesn't need the "truncate Go's
//! 9-digit fractional seconds to Python's 6-digit limit" workaround —
//! the `time` crate's RFC3339 parser (`time::format_description::well_known::Rfc3339`)
//! handles arbitrary fractional-second precision natively. That whole
//! interop hack simply doesn't exist as a problem here.

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub fn parse(value: Option<&str>) -> Option<OffsetDateTime> {
    let text = value?.trim();
    if text.is_empty() {
        return None;
    }
    OffsetDateTime::parse(text, &Rfc3339).ok()
}

/// Seconds from the server's "now" (or, absent that, our own wall clock —
/// used only for the START of the interval; `until` still comes from the
/// server) to `until`. Using the server's own clock for both ends keeps
/// the device's clock out of the calculation.
pub fn seconds_between(server_time: Option<&str>, until: &str) -> Option<f64> {
    let end = parse(Some(until))?;
    let start = parse(server_time).unwrap_or_else(OffsetDateTime::now_utc);
    Some((end - start).as_seconds_f64())
}

/// Current UTC time as `YYYY-MM-DDTHH:MM:SSZ`, matching the Python
/// original's `time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())`.
pub fn now_string() -> String {
    let now = OffsetDateTime::now_utc();
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", now.year(), u8::from(now.month()), now.day(), now.hour(), now.minute(), now.second())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parses_z_suffix_as_utc() {
        let dt = parse(Some("2026-01-01T12:00:00Z")).unwrap();
        assert_eq!(dt.offset().whole_seconds(), 0);
        assert_eq!(dt.hour(), 12);
    }

    #[test]
    fn test_parses_explicit_offset() {
        let dt = parse(Some("2026-01-01T12:00:00+05:30")).unwrap();
        assert_eq!(dt.offset().whole_minutes(), 5 * 60 + 30);
    }

    #[test]
    fn test_handles_nanosecond_precision_natively() {
        // Go emits 9 fractional digits; unlike Python's fromisoformat (max
        // 6), the `time` crate's RFC3339 parser handles this natively.
        let dt = parse(Some("2026-01-01T12:00:00.123456789Z")).unwrap();
        assert_eq!(dt.nanosecond(), 123456789);
    }

    #[test]
    fn test_none_and_empty_return_none() {
        assert!(parse(None).is_none());
        assert!(parse(Some("")).is_none());
    }

    #[test]
    fn test_garbage_input_returns_none_not_a_panic() {
        assert!(parse(Some("not a timestamp")).is_none());
    }

    #[test]
    fn test_seconds_between_uses_server_clock_for_both_ends() {
        let remaining = seconds_between(Some("2026-01-01T12:00:00Z"), "2026-01-01T13:00:00Z").unwrap();
        assert!((remaining - 3600.0).abs() < 0.001);
    }

    #[test]
    fn test_seconds_between_negative_when_deadline_already_passed() {
        let remaining = seconds_between(Some("2026-01-01T13:00:00Z"), "2026-01-01T12:00:00Z").unwrap();
        assert!((remaining + 3600.0).abs() < 0.001);
    }

    #[test]
    fn test_seconds_between_falls_back_to_now_when_server_time_missing() {
        let far_future = "2099-01-01T00:00:00Z";
        let remaining = seconds_between(None, far_future).unwrap();
        assert!(remaining > 0.0);
    }

    #[test]
    fn test_seconds_between_none_when_until_unparseable() {
        assert!(seconds_between(Some("2026-01-01T12:00:00Z"), "garbage").is_none());
    }
}
