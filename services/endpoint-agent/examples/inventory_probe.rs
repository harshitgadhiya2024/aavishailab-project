//! Manual probe: prints what the inventory collector finds on this machine.
//! Not a test — it asserts nothing, because the correct answer depends
//! entirely on which host it runs on. It exists so the collector can be
//! eyeballed on a real OS before trusting it in a release.
fn main() {
    let apps = aavishield_agent::inventory::collect();
    println!("collected {} application(s)", apps.len());
    for app in apps.iter().take(15) {
        println!("  {:<34} {:<14} {:<10} {}", app.name, app.version, app.source, app.identifier);
    }
}
