# Gear mathematics kernel, 2026-09-27

For integration copy **both `gearMath.ts` and `generatedRoot.ts`**. No third-party runtime dependencies. Source geometry uses double-precision JS numbers; final positions use Float32Array for WebGL and STL.

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
- Internal spur: complete analytic involute flanks from tooth tip to root; sharp intersection with the root circle. A generating-pinion root fillet is not included. Below-base-circle internal tips are rejected.
- Rack: straight-flank trapezoidal teeth with exact pressure angle and flat tip/root; sharp roots. Profile shift changes the reference-line datum.
- Herringbone: opposite swept helices share one middle section, so the result is a single watertight shell. No middle relief groove.

The generated external root checks positional joining, tangent joining and radial monotonicity. Parameters requiring trimmed undercut loops are **rejected**, not exported with a decorative replacement. The undercut warning in `deriveGear` is only a preliminary virtual-spur screen. Actual root generation performs stronger geometric checks.

## Formulas and source checks

Reference equations: m_t=m_n/cosβ; tanα_t=tanα_n/cosβ; d=z·m_t; d_b=d·cosα_t; external d_a=d+2m_n(1+x), d_f=d−2m_n(1.25−x); internal d_a=d−2m_n(1−x), d_f=d+2m_n(1.25+x). External s_n=m_n(π/2+2x·tanα_n)−j_n, s_t=s_n/cosβ. Involute invα=tanα−α. Helical sweep dθ/dz=tanβ/r.

Verified against [KHK Calculation of Gear Dimensions](https://khkgears.net/gear-knowledge/gear-technical-reference/calculation-gear-dimensions/) and [SDP/SI Elements of Metric Gear Technology, sections 4–6](https://www.sdp-si.com/resources/elements-of-metric-gear-technology/page3.php). KHK indexed tables provided standard spur dimensions and normal-system helical transformations. SDP/SI explains generating tools, profile shift, undercut and why internal cutter geometry matters. Direct web opening of SDP/SI returned 403; its indexed primary-source text was available. Some KHK HTML responses were compressed/broken through the web reader, so indexed primary-source tables were used.

Rounded rack envelope is an explicit mathematical construction, adapted from the preserved local Python `gear_engine/profile.py::_explicit_tool_root_geometry`, independently checked against the circular-center trochoid normal-offset equation. Helical tool/line tangency span is derived as `(h*cosβ/tanα_n − (a²−b²)*cosα_n/a)/r`, with `a=ρ/cosβ`, `b=ρ`, `h=h_f−ρ`. The local old project was read only.

## What accuracy means here

`profileTolerance` controls adaptive **2D** contour subdivision. Each segment is checked at 1/4, 1/2 and 3/4 parameter points; this is a measured sampling criterion, not a formal global Hausdorff guarantee. Default min(0.01mm, 0.005m). Root/involute positional joins are checked at max(1e−7mm,1e−7m); invalid joins fail. Numeric root diagnostics expose join error, tangent difference and sampled chord error. The helix is tessellated axially (at most 1.5 degrees per slice); no certified 3D error tolerance is claimed. STL is unitless by format convention; coordinates here are mm.

Closed mesh verification does not establish pair interference, center distance, contact ratio, assembly, machining tolerance, load capacity, printer dimensional accuracy or service life. No bevel, worm wheel, cycloidal, hypoid or noncircular geometry is generated. A ZA worm is also not implemented in this module. These families must remain unavailable for exact export until their own kernels exist.

## Verification

Run `node --experimental-strip-types --test work/gear-math/gearMath.test.ts` from the chat directory. **23 tests pass**:

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
