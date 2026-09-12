# Orbital Siege device handoff

Status: READY FOR DEVICE TEST.

One authored sequence uses the existing outpost economy. With an active extractor and 60 stored lunar ore, the Orbital Platform objective appears in Outpost Operations. Construction requires an idle miner, completed module work, and at least 8 kW generated solar capacity. It spends 60 ore once, reserves 6 kW and two of the three robots, and reduces ore delivery by 25% while labor is diverted. It does not occupy the existing module slot.

At six seconds, a five-second Command Phase opens. Choose defense, preserve mining, or harden the platform; timeout selects hardening. Three drone passes resolve at 18, 26, and 34 seconds of active surface time. No further waves spawn. Defense power comes from capacity remaining after base systems and platform work; insufficient power causes greater wave damage. The command panel shows available power before selection.

At full defense power, defense finishes with 85% hull and no new outpost damage; hardening finishes with 94% hull and a persistent 24% production penalty. Preserving mining finishes with 16% hull, 36% production damage, loss of up to 30 stored ore, and 25% solar capacity loss. Operational platforms give a persistent 20% ore delivery benefit. Siege production damage compounds with existing Counterstrike damage.

Repair costs 20 ore, reserves 4 kW and two robots for 15 seconds, and restores siege hull, production and energy. It does not refund lost ore or repair Counterstrike damage. Paid replay spends another 60 ore, restarts the same wave sequence and carries existing siege damage forward. Existing cinematic replay behavior is unchanged.

Save schema 8 migrates versions 1–7. Saves preserve partial assembly, the remaining command window, resolved wave count and outcomes. Siege time pauses off the surface, in a hidden tab, at the entry gate, and during other cinematics. Reset uses the existing confirmed whole-run reset.

## Device checks

- Check platform assembly, drone passes and damaged hull visibility above the outpost in portrait and landscape.
- Check touch targets and scroll access for all three five-second Command Phase choices.
- Background the app during Command Phase, resume, and verify the remaining decision time is preserved.
- Refresh during construction or between waves; verify no cost or wave is applied twice.
- Compare defense, mining and hardening on a powered outpost. Inspect energy, robot assignment, ore rate and damage after each wave.
- Repair a failed platform, replay the siege, then verify First Strike/Counterstrike replay and whole-run reset remain accessible.

## Validation scope

Passed focused simulation, operations, base construction, save, core/reset and strike outcome unit tests; the single Orbital Siege Playwright workflow against the final production build (24.8 seconds); lint; typecheck; and production build. The build reports a bundle-size advisory. No broad cinematic suites, commits or pushes.

Browser captures are in `artifacts/screenshots/orbital-siege/`: assembly, inbound drones, first wave, Command Phase, failure and orbital control. The browser clock is installed before renderer initialization and advances the regular simulation timers; screenshot review confirms the command text wraps and damaged hull remains visible. Physical device checks above remain to be performed.
