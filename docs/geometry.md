# Gear mathematics kernel v0.3, 2026-09-27

For the involute kernel copy **both `gearMath.ts` and `generatedRoot.ts`**. Application integration dispatches through `model.ts`, which also requires `wormGeometry.ts` and `cycloidalGeometry.ts`. No third-party runtime dependencies. Source geometry uses double-precision JS numbers; final positions use Float32Array for WebGL and STL.

## API

```ts
const params = { ...defaultGearParams, kind: 'helical', teeth: 24, module: 2 };
const mesh = buildGearMesh(params, { flankSamples: 16 });
const result = validateMesh(mesh);
const stl: ArrayBuffer = exportBinarySTL(mesh);
```

`deriveGear(params)` → `{params,dimensions,warnings}`. `buildGearProfile(params, samples)` adds `outer`, `hole`, and optional `rootDiagnostics`. Both contours are CCW and omit a duplicate closing point. `buildGearMesh` adds positions, indices, profile and tessellation. Errors are `GearGeometryError` with a stable `code` and Russian explanatory message. Export refuses a mesh failing its topology checks. `warnings` on the generated mesh contain the actual root model; use these for the UI.

Units are mm. Module and pressure angle are **normal** for helical/herringbone. `backlash` is the normal tooth thickness reduction **on this gear**, not the backlash of an assembled pair. Positive `helixAngleDeg` increases polar angle with axial z. Internal `profileShift` uses rack-shift sign convention: positive x makes internal teeth thinner. `bore` is for external gears; hide it for internal/rack. `rimThickness` and `rackBaseHeight` default to 3m.

## Geometry delivered

- External spur, helical and herringbone: analytic involute working flanks plus the secondary envelope of an explicitly specified rounded rack cutter. The cutter-tip circle in the normal plane projects to a transverse ellipse for helical gears. Default tool tip radius is 0.3m; this is an **assumed input tool**, not a recovered or universally standardized radius. `toolTipRadiusCoefficient` can specify it.
- Internal spur and helical: complete analytic involute flanks from tooth tip to root; sharp intersection with the root circle. A generating-pinion root fillet is not included. Below-base-circle internal tips are rejected.
- Straight and helical rack: straight-flank trapezoidal teeth with exact pressure angle and flat tip/root; sharp roots. Profile shift changes the reference-line datum. The helical rack uses the transverse pressure angle and linear sweep x(z)=x₀+z·tanβ; rackAxialOffset=b·tanβ and its bounding length includes this skew.
- Herringbone: opposite swept helices share one middle section, so the result is a single watertight shell. No middle relief groove.

The generated external root checks positional joining, tangent joining and radial monotonicity. Parameters requiring trimmed undercut loops are **rejected**, not exported with a decorative replacement. The undercut warning in `deriveGear` is only a preliminary virtual-spur screen. Actual root generation performs stronger geometric checks.

## Formulas and source checks

Reference equations: m_t=m_n/cosβ; tanα_t=tanα_n/cosβ; d=z·m_t; d_b=d·cosα_t; external d_a=d+2m_n(1+x), d_f=d−2m_n(1.25−x); internal d_a=d−2m_n(1−x), d_f=d+2m_n(1.25+x). External s_n=m_n(π/2+2x·tanα_n)−j_n, s_t=s_n/cosβ. Involute invα=tanα−α. Helical sweep dθ/dz=tanβ/r.

Verified against [KHK Calculation of Gear Dimensions](https://khkgears.net/gear-knowledge/gear-technical-reference/calculation-gear-dimensions/) and [SDP/SI Elements of Metric Gear Technology, sections 4–6](https://www.sdp-si.com/resources/elements-of-metric-gear-technology/page3.php). KHK indexed tables provided standard spur dimensions and normal-system helical transformations. SDP/SI explains generating tools, profile shift, undercut and why internal cutter geometry matters. Direct web opening of SDP/SI returned 403; its indexed primary-source text was available. Some KHK HTML responses were compressed/broken through the web reader, so indexed primary-source tables were used.

Rounded rack envelope is an explicit mathematical construction, adapted from the preserved local Python `gear_engine/profile.py::_explicit_tool_root_geometry`, independently checked against the circular-center trochoid normal-offset equation. Helical tool/line tangency span is derived as `(h*cosβ/tanα_n − (a²−b²)*cosα_n/a)/r`, with `a=ρ/cosβ`, `b=ρ`, `h=h_f−ρ`. The local old project was read only.

## What accuracy means here

`profileTolerance` controls adaptive **2D** contour subdivision. Each segment is checked at 1/4, 1/2 and 3/4 parameter points; this is a measured sampling criterion, not a formal global Hausdorff guarantee. Default min(0.01mm, 0.005m). Root/involute positional joins are checked at max(1e−7mm,1e−7m); invalid joins fail. Numeric root diagnostics expose join error, tangent difference and sampled chord error. The helix is tessellated axially (at most 1.5 degrees per slice); no certified 3D error tolerance is claimed. STL is unitless by format convention; coordinates here are mm.

Closed mesh verification does not establish pair interference, center distance, contact ratio, assembly, machining tolerance, load capacity, printer dimensional accuracy or service life. No octoid or spiral bevel, worm wheel, eccentric pin-reducer, hypoid or noncircular geometry is generated. Exact spherical-involute straight bevel, ZA worm and cylindrical cycloidal geometry are implemented separately in `bevelGeometry.ts`, `wormGeometry.ts` and `cycloidalGeometry.ts`; the UI dispatches through `model.ts`. Other unsupported families remain unavailable for STL.

## Verification

Run `npm test` from the repository. Geometry tests include the original 23 checks plus internal-helical, helical-rack, ZA, cycloidal and spherical-involute bevel cases:

- KHK numerical examples, normal/transverse conversions and signed profile-shift behavior.
- Involute polar equation versus independent Cartesian unwinding-string equation.
- Working flank coordinates versus analytic tooth-thickness equation.
- Generated root versus independent circular trochoid normal-offset construction.
- Helical root versus an independent direct ellipse-parameterized envelope (without the production Newton inverse solve).
- Root joining/tangency for spur/helical/herringbone; tighter contour convergence.
- Helix hand/lead and shared herringbone middle section.
- Closed oriented mesh and positive volume for each family; STL serialized, read back and welded by exact vertex coordinates before topology checks.
- Rack volume independently computed from base plus trapezoids; straight-extrusion mesh volume against polygon area × width.
- Browser resource preflight rejects meshes exceeding 250,000 vertices or 500,000 triangles before allocating mesh arrays.
- Representative 60-combination parameter matrix: valid models pass topology, unsupported parameter combinations are rejected.

Topology validation is not a general 3D triangle self-intersection detector. Profiles are checked/constructed as monotone noncrossing contours; external root loops are rejected. Physical printing and mating tests remain unperformed.

## ZA worm module

`module` is **axial** mx, `pressureAngleDeg` is axial αx, `width` is threaded length. `wormStarts`, `wormDiameterFactor` and `wormHand` control the helix; inherited `teeth` and `helixAngleDeg` do not. `deriveWorm` returns a separate `wormDimensions` object. d=q·mx, lead=π·mx·starts, γ=atan(starts/q), mn=mx·cosγ, tanαn=tanαx·cosγ. The axial generating section has straight flanks and flat tip/root lands. The model uses ha=mx and hf=1.25mx; nonzero profile shift is rejected.

Sources: [KHK §4.6](https://khkgears.net/new/gear_knowledge/gear_technical_reference/calculation_gear_dimensions.html) and [Litvin & Fuentes, cylindrical worm drives](https://www.cambridge.org/core/books/abs/gear-geometry-and-applied-theory/wormgear-drives-with-cylindrical-worms/2583169B30F6E4D894D605D56E05BBE7). Tests compare a published KHK example, axial section intersections, screw motion, independent integrated volume, both hands and 1/2/4/8 starts, and STL roundtrip.

No tool fillets, runout, end chamfer, hub, conjugate worm wheel, pair contact or strength calculation. `baseDiameter` and `basePitch` compatibility fields are zero meaning **not applicable**, not an involute base circle. Printing checks use axial tip width and the normal width on the developed tip cylinder; a coarse layer or helical overhang still requires slicer inspection. Mesh topology and geometric print screening are separate from manufacturing acceptance.

## Cylindrical cycloidal module

`CycloidalParams = Omit<GearParams, 'kind'> & { kind: 'cycloidal'; cycloidRollingRadius?: number }`.
`deriveCycloidal` and `buildCycloidalMesh` return distinct `cycloidalDimensions`; the mesh also carries `cycloidalDiagnostics`. Module is reference circular pitch / π; R = mz/2. One rolling-circle radius r generates both face and flank, default `min(2m, R/2)`. The selected height system is ha=m, hf=1.25m, explicitly an input assumption rather than a universal cycloidal standard. Reference tooth thickness is πm/2 − backlash; this is thinning of one wheel, not assembled backlash. Nonzero profile shift and helix angle are rejected. A constant involute pressure angle does not apply.

For rolling-centre angle t, the Cartesian curves are:

- Epicycloid: x=(R+r)cos(t)−r cos((R+r)t/r), y=(R+r)sin(t)−r sin((R+r)t/r).
- Hypocycloid: x=(R−r)cos(t)+r cos((R−r)t/r), y=(R−r)sin(t)−r sin((R−r)t/r).

Only the first radially monotone branches, 0≤Rt/r≤π, are used. The selected radius must satisfy 0<r≤R/2 and reach the root radius R−hf. Curves are cut at exact radial inversions, rotated by reference half thickness and mirrored. Tooth tips and gaps are circular arcs. Angular bounds reject pointed tips and overlap of adjacent roots. At r=R/2 the hypocycloid is the exact radial segment x=R cos(t), y=0. A conjugate counterpart requires compatible rolling circles and tooth heights; m and z alone cannot establish meshability. No mating contact or strength certificate is implied, and this is not a cycloidal pin reducer.

Definitions checked against [Wolfram Epicycloid, equations 1–2](https://mathworld.wolfram.com/Epicycloid.html), [Wolfram Hypocycloid, equations 7–8 and radial special case](https://mathworld.wolfram.com/Hypocycloid.html), and the independent [FreeCAD Gears source](https://github.com/looooo/freecad.gears/blob/master/pygears/cycloid_tooth.py). Equations and implementation here were written independently; no FreeCAD runtime or code is included.

Adaptive segments use the C² interpolation inequality `error ≤ max|f''| · Δt² / 8`. On these branches the second-derivative norm increases for the epicycloid and decreases for the hypocycloid, so the relevant endpoint gives its exact interval maximum. Circular arcs use their sagitta. Default tolerance is 0.002m; the accepted range is 1e-6 mm through 0.5m. The returned bound includes the bore contour. It describes the analytic 2D contour before Float32 conversion, not a certified 3D STL or manufacturing tolerance. Mesh budgets are 250,000 vertices / 500,000 triangles, with bounded subdivisions and a 4,096-point per-tooth triangulation budget. Lost Float32 faces are rejected.

A separately sampled circular bore and one-tooth sector triangulation avoid zero-area caps when dedenda are radial. The template is replicated without duplicated seam vertices and extruded with flat caps. Tests compare independent Cartesian curves, pitch-circle thickness, reflection/rotation symmetry, the radial case, several bores, STL roundtrips, a scale/tooth-count matrix, and volume convergence against an independent analytic Green-theorem line integral.

`GearDimensions` numeric compatibility fields use zero for unavailable involute-only quantities. User-facing v3 reports call `modelDimensionsForReport` and instead serialize pressure angles, base diameter/pitch and involute shift limits as `null`; use `cycloidalDimensions` for this family. The model passport does not inherit any pair approval from the separate pair dialog. The photo inverse solver explicitly excludes cycloidal teeth.

## Separate pair report

The UI's `PairDialog` uses `pairAnalysis.ts` for ideal unloaded involute external, internal and rack pairs. It reports the given two parts, actual or calculated operating distance, compatibility, backlash, radial clearance and contact ratios with stated restrictions. Its JSON is separate from the single-part passport. Unsupported worm and cycloidal pairs return an explicit unsupported status, never an involute substitute. See `pair-analysis.md` for equations and limits.

## Straight bevel module

`bevelGeometry.ts` implements the exact spherical involute with radial generators from a common apex, not a tapered cylindrical involute. `module` is the outer module, `width` is face width along the pitch generator; `bevelMateTeeth` and `bevelShaftAngleDeg` fix the pitch cone. Root and tip heights follow the explicit outer ha=m, hf=1.25m system. The supported root must remain at or above the base cone. A below-base root is rejected as an unimplemented generated transition, not declared physically impossible or undercut.

The tooth ends are back cones; the core ends inside the root circles are flat. The true cylinder bore stays constant. The large flat end lies at world z=0; apex and reflection/translation are recorded alongside the spatial end contours. FDM uses the small-end tip chord and root-to-bore wall. The diagram tab is an XY projection, not a manufacturing section. The outer reference-sphere base circle is named separately; cylindrical base diameter/pitch are not applicable.

Analytic interpolation bounds cover the spherical flank and conical caps before Float32 rounding. Tests independently check rolling-plane coordinates, pressure angle from the tangent, cone sections, both pitch cones, watertight oriented STL, root seams, bore, faceted volume and convergence to integrated analytic volume. See [full formulas, sources, supported domain and tests](bevel-geometry.md). No octoid/Gleason/spiral geometry, generated root fillet, working pair contact or strength certificate is claimed.
