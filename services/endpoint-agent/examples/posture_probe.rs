//! Prints this machine's posture signals exactly as the heartbeat sends
//! them — for checking a probe on a real device without enrolling it.
//!
//!   cargo run --example posture_probe

fn main() {
    println!("{}", serde_json::to_string_pretty(&aavishield_agent::posture::collect()).unwrap());
}
