Focused orbital repair on `feature/territory-visual-polish`, 2026-09-13.

All four monument meshes remain visible in orbit. The completed reveal's camera
position, target, up vector, field of view and lighting carry into orbital
inspection. The original reveal path, monument geometry and saved anchors are
unchanged. The landing-basin Crown retains its terrain during the return handoff.
Surface base details remain culled, and inspection zoom stays above the Moon.

The warhead confirmation now reads: “Launching the warhead ends this prototype run.”
The production dialog and its cancel action were checked in the browser.

Validation passed: the existing Territory Monuments workflow, Orbital Siege
workflow and three camera collision cases; all four monument silhouettes and
both Crown anchors, including normal and early reveal exits and claim reload;
43 focused camera/monument unit tests; lint; typecheck; production build; and
`git diff --check`. No jumps were measured across the tested camera handoffs,
all projected silhouettes fit the portrait frame, and no WebGL errors or context
loss occurred. Claim, wave and earlier strike facts survive replay and reload.

[Orbital screenshot](../screenshots/territory-visual-polish/orbital-repair/helios-spire-orbit.png)
shows the Spire at the default completed-monument orbit on a 390×844 viewport.
[Browser metrics](orbital-repair-metrics.json) record the inspected frames.
The browser checks enforce ceilings of 80 draw calls, 120,000 orbital triangles
and 24 shader programs. Final JavaScript gzip is 394,558 bytes (385.31 KiB), below
the existing 400 KiB ceiling. Vite retains its existing raw chunk-size advisory.

Final bundle: `index-BImoEzE9.js`, 1,448,837 raw bytes; SHA-256
`43b1364bdc8934f8440c2e6121db601717986cf75ca93a2551acbe6a833dfb06`.
Gameplay, costs, resource math, wave rules and persistence code have no changes.
Nothing was committed or pushed.
