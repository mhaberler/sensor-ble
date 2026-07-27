# Verifying a GATT protocol against real hardware via ble-mcp

Use this when a device from the target family is reachable over BLE and the `ble` MCP server (ble-mcp) is configured. This is optional but strongly preferred over trusting a reference app or spec alone -- see the parent skill's "Why verify against real hardware" section.

## Tool sequence

All `mcp__ble__*` tools are deferred -- load them first with `ToolSearch` (e.g. `query: "select:mcp__ble__ble_scan_start,mcp__ble__ble_connect,mcp__ble__ble_discover,mcp__ble__ble_read,mcp__ble__ble_subscribe,mcp__ble__ble_wait_notification,mcp__ble__ble_unsubscribe,mcp__ble__ble_disconnect"`).

1. **Find the device**
   ```
   ble_scan_start(name_filter: "<device name substring>", timeout_s: 10)
   ble_scan_get_results(scan_id: ...)
   ```
   Confirm the advertised name and, importantly, the advertised `service_uuids` -- this is what the decoder's `serviceUUID` matching field should use. Don't assume it's the same UUID as the primary data service; vendors sometimes advertise a distinct "base" UUID rather than the specific service's own UUID.

   If the first connect attempt below times out, the device may have stopped advertising (some peripherals stop advertising while connected, or briefly drop out). Re-scan without a name filter to see current state before retrying.

2. **Connect and discover the full GATT table**
   ```
   ble_connect(address: "<mac>", timeout_s: 15)
   ble_discover(connection_id: ...)
   ```
   `ble_discover` returns every service/characteristic with its **properties** (`read`, `write`, `notify`, etc.) and descriptor handles. This is the single most valuable call -- it tells you definitively which characteristics can be reached via `notify[]` (must have `notify` in properties) versus which are read-only (cannot be reached at all through `sensor-ble`'s write-only `BleApi`).

3. **Spot-read characteristics for reference values**
   ```
   ble_read(connection_id: ..., char_uuid: "<uuid>")
   ```
   Use this on every characteristic of interest, even read-only ones -- you can still record their values in your decoder's documentation/comments or use them to sanity-check byte layouts, even though the decoder itself can't reach them at runtime. Returns `value_hex`/`value_b64`/`value_len` -- use `value_len` to confirm the byte count matches what a spec claims.

4. **Capture a live notification**
   ```
   ble_subscribe(connection_id: ..., char_uuid: "<uuid>")
   ble_wait_notification(connection_id: ..., subscription_id: ..., timeout_s: 20)
   ```
   Decode the returned `value_hex` by hand (a throwaway Python/Node one-liner is fine) against the spec's byte layout *before* writing it into the decoder or a test fixture. Cross-check the result is physically plausible for the sensor type (e.g. temperature in a sane range, pressure not wildly off from expected). If a captured payload's hex length doesn't match your byte-offset math, recount `len(hex_string) / 2` first -- this is a common self-inflicted error, not necessarily a protocol mismatch.

5. **Clean up**
   ```
   ble_unsubscribe(connection_id: ..., subscription_id: ...)
   ble_disconnect(connection_id: ...)
   ```
   Always disconnect when done investigating, even mid-task -- leaving a connection open can block subsequent connect attempts (`ble_connections_list` shows any stale connections if a later connect unexpectedly times out).

## What to bring back into the decoder

- The exact `serviceUUID` to use for device matching (from step 1's advertisement, not assumed from a service's own UUID).
- Which characteristics are notify-capable vs read-only (from step 2) -- this determines decoder scope.
- At least one real captured payload (from step 4) to use as a `tests` fixture, plus your hand-decoded expected values.
