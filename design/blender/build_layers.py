"""
RoadAssist Bharat - the seven-layer stack, modelled in Blender.

Builds the model the web page app/apps/web/layers.html shows, exports it as
glTF binary for three.js, and renders a still (the page's poster) and,
optionally, a turntable film. Run headless, so an open Blender window is
left alone:

  blender -b --factory-startup -P design/blender/build_layers.py -- <out_dir> [--still] [--film]

Every part is a small model of what it stands for - a phone for the citizen
app, a rack for Render, a padlock for access control - built from primitives,
so the whole file is reproducible from this script alone.

Node names are the contract with the page:
  layer_<id>          a slab; everything below is its child
  comp_<id>_<n>       the n-th part on it (pickable, highlighted on a journey)
  conduit_<id>_<k>    a light pipe down to the next slab; the page stretches
                      it with the gap, so it is modelled for GAP and origin-top
  plinth              the base the stack stands on
"""
import math
import os
import sys

import bpy
import bmesh

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = next((a for a in ARGS if not a.startswith("--")), os.path.dirname(os.path.abspath(__file__)))
DO_STILL = "--still" in ARGS
DO_FILM = "--film" in ARGS
os.makedirs(OUT, exist_ok=True)

# Same order, ids, colours and parts as LAYERS in layers.html (top first).
LAYERS = [
    ("people", "People & devices", 0xE3B96A,
     ["phone", "android", "laptop", "monitor", "featurephone"]),
    ("edge", "Offline edge", 0x3FB68B, ["shield", "discs", "queue", "signal"]),
    ("api", "API gateway", 0x4C8DFF, ["gate", "check", "key", "padlock", "antenna"]),
    ("domain", "Domain services", 0x9B7BFF, ["flow", "pin", "siren", "funnel", "coins"]),
    ("data", "Data", 0x29B6C9, ["database", "grid", "scroll", "key"]),
    ("ai", "AI", 0xFF7A59, ["camera", "chip", "gears", "person"]),
    ("cloud", "Cloud & delivery", 0x8A93A6, ["rack", "page", "cycle", "envelope"]),
]
W, D, TH = 7.4, 4.4, 0.22
GAP = 1.75
N = len(LAYERS)


# ── colour & materials ──────────────────────────────────────────────────────
def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hexv, white=0.0):
    r, g, b = ((hexv >> 16) & 255) / 255, ((hexv >> 8) & 255) / 255, (hexv & 255) / 255
    return tuple(lin(x + (1 - x) * white) for x in (r, g, b)) + (1.0,)


_mats = {}


def mat(name, hexv, *, alpha=1.0, rough=0.35, metal=0.0, coat=0.0, emit=0.0, white=0.0, emit_white=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = rgba(hexv, white)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Alpha"].default_value = alpha
    p.inputs["Coat Weight"].default_value = coat
    p.inputs["Coat Roughness"].default_value = 0.12
    p.inputs["Emission Color"].default_value = rgba(hexv, emit_white)
    p.inputs["Emission Strength"].default_value = emit
    if alpha < 1.0:
        m.surface_render_method = "BLENDED"
    _mats[name] = m
    return m


def palette(lid, hexv):
    """The five finishes every part on a layer is made of."""
    return {
        "body": mat(f"body_{lid}", hexv, rough=0.3, coat=0.6, white=0.6, emit=0.35, emit_white=0.5),
        "tint": mat(f"tint_{lid}", hexv, rough=0.28, coat=0.5, metal=0.2, white=0.15, emit=0.3),
        "glow": mat(f"glow_{lid}", hexv, emit=6.0, emit_white=0.25, white=0.3),
        "screen": mat(f"screen_{lid}", 0x0B0F18, rough=0.06, coat=1.0, emit=2.2, emit_white=0.0),
        "metal": mat("metal", 0xC9CED8, rough=0.22, metal=1.0),
        "dark": mat("dark", 0x1A1F2B, rough=0.35, metal=0.6),
        "white": mat("whiteglow", 0xFFFFFF, emit=4.0, emit_white=1.0),
        "red": mat("redglow", 0xFF3B3B, emit=8.0, emit_white=0.1),
    }


# ── primitives: each built at the origin, bevelled and baked, ready to join ──
def _finish(ob, m, bevel=0.0, seg=2, smooth=True):
    if bevel:
        mod = ob.modifiers.new("b", "BEVEL")
        mod.width = bevel
        mod.segments = seg
        mod.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier="b")
    ob.data.materials.clear()
    ob.data.materials.append(m)
    if smooth:
        for poly in ob.data.polygons:
            poly.use_smooth = True
    return ob


def _apply(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def box(sx, sy, sz, loc=(0, 0, 0), rot=(0, 0, 0), m=None, bevel=0.02, seg=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = (sx, sy, sz)
    _apply(ob)
    return _finish(ob, m, bevel, seg)


def cyl(r, h, loc=(0, 0, 0), rot=(0, 0, 0), m=None, verts=24, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    ob = bpy.context.active_object
    _apply(ob)
    return _finish(ob, m, bevel, 2)


def cone(r1, r2, h, loc=(0, 0, 0), rot=(0, 0, 0), m=None, verts=24):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=loc, rotation=rot)
    ob = bpy.context.active_object
    _apply(ob)
    return _finish(ob, m)


def ball(r, loc=(0, 0, 0), m=None, seg=20, rings=12, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    ob = bpy.context.active_object
    ob.scale = scale
    _apply(ob)
    return _finish(ob, m)


def ring(R, r, loc=(0, 0, 0), rot=(0, 0, 0), m=None, major=32, minor=8, arc=1.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=major, minor_segments=minor,
                                     location=loc, rotation=rot)
    ob = bpy.context.active_object
    if arc < 1.0:
        # Cut the ring open: keep vertices within the arc, for a "cycle" arrow.
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        cut = [v for v in bm.verts if (math.atan2(v.co.y, v.co.x) % (2 * math.pi)) > arc * 2 * math.pi]
        bmesh.ops.delete(bm, geom=cut, context="VERTS")
        bm.to_mesh(ob.data)
        bm.free()
    _apply(ob)
    return _finish(ob, m)


def tube(points, r, m, closed=False, res=2):
    """A bevelled poly-curve through the points, baked to a mesh."""
    cu = bpy.data.curves.new("tube", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for p, co in zip(sp.points, points):
        p.co = (co[0], co[1], co[2], 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new("tube", cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.active_object
    return _finish(ob, m)


def rounded_rect(w, d, r, z, per=6):
    pts = []
    for cx, cy, a0 in [(w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90),
                       (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)]:
        for k in range(per + 1):
            a = math.radians(a0 + 90 * k / per)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
    return pts


def text(body, size, loc, m, extrude=0.012, rot=(0, 0, 0)):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "LEFT"
    cu.resolution_u = 3
    ob = bpy.data.objects.new("txt", cu)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.active_object
    _apply(ob)
    return _finish(ob, m, smooth=False)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    return ob


# ── the parts: each fits a 0.9 x 0.6 footprint, stands on z = 0 ─────────────
def pad(P):
    return [cyl(0.4, 0.03, (0, 0, 0.015), m=P["dark"], verts=32),
            ring(0.4, 0.013, (0, 0, 0.032), m=P["glow"], major=40, minor=6)]


def part(kind, P):
    b, t, g, s, mt, dk, wg, rd = (P[k] for k in ("body", "tint", "glow", "screen", "metal", "dark", "white", "red"))
    tilt = (math.radians(-12), 0, 0)
    o = pad(P)
    if kind == "phone":
        o += [box(0.32, 0.05, 0.6, (0, 0.02, 0.36), tilt, b, 0.05, 3),
              box(0.27, 0.01, 0.5, (0, -0.012, 0.365), tilt, s, 0.02),
              box(0.08, 0.012, 0.012, (0, -0.02, 0.62), tilt, g, 0.004)]
    elif kind == "android":
        o += [box(0.32, 0.05, 0.6, (0, 0.02, 0.36), tilt, t, 0.05, 3),
              box(0.27, 0.01, 0.5, (0, -0.012, 0.365), tilt, s, 0.02),
              ball(0.09, (0, -0.05, 0.4), g, scale=(1, 0.4, 0.8))]
    elif kind == "laptop":
        o += [box(0.72, 0.46, 0.04, (0, 0.02, 0.07), m=b, bevel=0.015),
              box(0.6, 0.26, 0.006, (0, -0.02, 0.092), m=dk, bevel=0.003),
              box(0.72, 0.03, 0.44, (0, 0.24, 0.3), (math.radians(-18), 0, 0), b, 0.015),
              box(0.64, 0.01, 0.37, (0, 0.215, 0.3), (math.radians(-18), 0, 0), s, 0.005)]
    elif kind == "monitor":
        o += [box(0.2, 0.2, 0.02, (0, 0.05, 0.05), m=mt, bevel=0.008),
              box(0.05, 0.04, 0.22, (0, 0.06, 0.16), m=mt, bevel=0.01),
              box(0.8, 0.05, 0.46, (0, 0.03, 0.46), m=dk, bevel=0.02),
              box(0.74, 0.01, 0.4, (0, 0.0, 0.46), m=s, bevel=0.005)]
        o += [box(0.08, 0.008, 0.06 + 0.05 * k, (-0.22 + 0.11 * k, -0.01, 0.34 + (0.06 + 0.05 * k) / 2), m=g, bevel=0.003)
              for k in range(5)]
    elif kind == "featurephone":
        o += [box(0.26, 0.08, 0.5, (0, 0.02, 0.3), tilt, b, 0.04, 3),
              box(0.2, 0.01, 0.15, (0, -0.02, 0.45), tilt, s, 0.01)]
        for rr in range(3):
            for cc in range(3):
                o.append(box(0.045, 0.02, 0.03, (-0.06 + 0.06 * cc, -0.025 + 0.012 * rr, 0.3 - 0.055 * rr), tilt, g, 0.006))
    elif kind == "shield":
        o += [cone(0.2, 0.0, 0.32, (0, 0, 0.26), (math.pi, 0, 0), t, 32),
              cyl(0.2, 0.2, (0, 0, 0.52), m=t, verts=32, bevel=0.03),
              box(0.05, 0.3, 0.22, (0, -0.02, 0.44), m=wg, bevel=0.01)]
    elif kind == "discs":
        for k in range(3):
            o += [cyl(0.26, 0.11, (0, 0, 0.1 + 0.14 * k), m=b, verts=32, bevel=0.03),
                  ring(0.26, 0.012, (0, 0, 0.16 + 0.14 * k), m=g, major=40, minor=6)]
    elif kind == "queue":
        o.append(box(0.8, 0.08, 0.03, (0, 0, 0.06), m=mt, bevel=0.01))
        o += [box(0.17, 0.2, 0.17, (-0.26 + 0.26 * k, 0, 0.17), m=(g if k == 0 else b), bevel=0.03, seg=3) for k in range(3)]
    elif kind == "signal":
        o += [box(0.1, 0.12, 0.12 + 0.13 * k, (-0.24 + 0.16 * k, 0, 0.06 + (0.12 + 0.13 * k) / 2), m=(g if k < 3 else b),
                  bevel=0.02) for k in range(4)]
    elif kind == "gate":
        o += [box(0.12, 0.3, 0.52, (-0.28, 0, 0.3), m=t, bevel=0.02),
              box(0.12, 0.3, 0.52, (0.28, 0, 0.3), m=t, bevel=0.02),
              box(0.8, 0.34, 0.1, (0, 0, 0.6), m=b, bevel=0.03),
              box(0.44, 0.02, 0.04, (0, -0.16, 0.6), m=g, bevel=0.005)]
    elif kind == "check":
        o.append(tube([(-0.25, 0, 0.36), (-0.08, 0, 0.2), (0.28, 0, 0.58)], 0.055, g))
        o.append(cyl(0.3, 0.05, (0, 0.08, 0.38), (math.pi / 2, 0, 0), b, 40, 0.01))
    elif kind == "key":
        o += [ring(0.12, 0.04, (-0.2, 0, 0.3), (math.pi / 2, 0, 0), t, 32, 10),
              cyl(0.03, 0.46, (0.12, 0, 0.3), (0, math.pi / 2, 0), t, 16),
              box(0.05, 0.05, 0.1, (0.28, 0, 0.24), m=t, bevel=0.01),
              box(0.05, 0.05, 0.07, (0.18, 0, 0.255), m=t, bevel=0.01),
              ball(0.03, (-0.2, 0, 0.3), g)]
    elif kind == "padlock":
        o += [box(0.42, 0.2, 0.34, (0, 0, 0.23), m=t, bevel=0.04, seg=3),
              ring(0.13, 0.03, (0, 0, 0.42), (math.pi / 2, 0, 0), mt, 32, 8, arc=0.5),
              cyl(0.035, 0.06, (0, -0.1, 0.25), (math.pi / 2, 0, 0), g, 16)]
    elif kind == "antenna":
        o += [cyl(0.03, 0.6, (0, 0, 0.33), m=mt, verts=12),
              ball(0.05, (0, 0, 0.66), g)]
        o += [ring(0.1 + 0.09 * k, 0.012, (0, 0, 0.66), (math.pi / 2, 0, 0), g, 40, 6, arc=0.36) for k in range(3)]
    elif kind == "flow":
        o += [box(0.18, 0.18, 0.18, (x, 0, 0.14 + z), m=(g if i == 1 else b), bevel=0.03, seg=3)
              for i, (x, z) in enumerate([(-0.26, 0), (0, 0.24), (0.26, 0)])]
        o += [tube([(-0.2, 0, 0.2), (-0.07, 0, 0.36)], 0.015, mt), tube([(0.07, 0, 0.36), (0.2, 0, 0.2)], 0.015, mt)]
    elif kind == "pin":
        o += [cone(0.13, 0.0, 0.3, (0, 0, 0.19), (math.pi, 0, 0), t, 32),
              ball(0.15, (0, 0, 0.42), t, 32, 16),
              ball(0.06, (0, -0.1, 0.44), wg)]
    elif kind == "siren":
        o += [cyl(0.2, 0.1, (0, 0, 0.1), m=dk, verts=32, bevel=0.02),
              ball(0.17, (0, 0, 0.16), rd, 32, 16, scale=(1, 1, 1.25)),
              ring(0.2, 0.015, (0, 0, 0.15), m=mt, major=40, minor=6)]
    elif kind == "funnel":
        o += [cone(0.32, 0.06, 0.34, (0, 0, 0.42), m=t, verts=32),
              cyl(0.06, 0.2, (0, 0, 0.16), m=t, verts=16),
              ring(0.32, 0.014, (0, 0, 0.59), m=g, major=40, minor=6)]
        o += [ball(0.035, (0.12 * math.cos(a), 0.12 * math.sin(a), 0.7), g) for a in (0.3, 2.4, 4.4)]
    elif kind == "coins":
        o += [cyl(0.16, 0.05, (-0.12 + 0.02 * (k % 2), 0, 0.07 + 0.055 * k), m=t, verts=32, bevel=0.01) for k in range(5)]
        o += [box(0.34, 0.03, 0.22, (0.2, 0.05, 0.2), (0, 0, math.radians(-15)), b, 0.02),
              box(0.3, 0.005, 0.03, (0.2, 0.03, 0.26), (0, 0, math.radians(-15)), g, 0.004)]
    elif kind == "database":
        for k in range(3):
            o += [cyl(0.28, 0.16, (0, 0, 0.13 + 0.18 * k), m=b, verts=40, bevel=0.035),
                  ring(0.28, 0.014, (0, 0, 0.21 + 0.18 * k), m=g, major=48, minor=6)]
    elif kind == "grid":
        o.append(box(0.66, 0.46, 0.05, (0, 0, 0.08), m=b, bevel=0.02))
        o += [box(0.18, 0.12, 0.03 + 0.03 * ((r + c) % 3), (-0.21 + 0.21 * c, -0.14 + 0.14 * r, 0.12), m=(g if (r, c) == (0, 0) else t),
                  bevel=0.01) for r in range(3) for c in range(3)]
    elif kind == "scroll":
        o += [box(0.42, 0.3, 0.02, (0.03 * k, 0.03 * k, 0.08 + 0.05 * k), m=b, bevel=0.01) for k in range(4)]
        o += [box(0.3, 0.02, 0.008, (0.09, -0.02 + 0.05 * k, 0.245), m=g, bevel=0.002) for k in range(3)]
    elif kind == "camera":
        o += [box(0.46, 0.3, 0.3, (0, 0.04, 0.24), m=dk, bevel=0.04, seg=3),
              cyl(0.12, 0.12, (0, -0.16, 0.24), (math.pi / 2, 0, 0), mt, 32),
              cyl(0.085, 0.02, (0, -0.225, 0.24), (math.pi / 2, 0, 0), s, 32),
              ring(0.12, 0.012, (0, -0.22, 0.24), (math.pi / 2, 0, 0), g, 40, 6),
              ball(0.025, (0.17, -0.11, 0.35), rd)]
    elif kind == "chip":
        o += [box(0.42, 0.42, 0.08, (0, 0, 0.12), m=dk, bevel=0.02),
              box(0.24, 0.24, 0.02, (0, 0, 0.17), m=g, bevel=0.01)]
        for k in range(5):
            for sx, sy, w_, d_ in [(1, 0, 0.1, 0.03), (-1, 0, 0.1, 0.03), (0, 1, 0.03, 0.1), (0, -1, 0.03, 0.1)]:
                off = -0.16 + 0.08 * k
                o.append(box(w_, d_, 0.015, (0.26 * sx + off * abs(sy), 0.26 * sy + off * abs(sx), 0.1), m=mt, bevel=0.0))
    elif kind == "gears":
        for cx, r, z in [(-0.14, 0.18, 0.3), (0.18, 0.13, 0.22)]:
            o.append(cyl(r, 0.08, (cx, 0, z), (math.pi / 2, 0, 0), t, 32, 0.01))
            o.append(cyl(r * 0.35, 0.1, (cx, 0, z), (math.pi / 2, 0, 0), g, 20))
            teeth = 10 if r > 0.15 else 8
            o += [box(0.06, 0.08, 0.06, (cx + (r + 0.02) * math.cos(2 * math.pi * k / teeth), 0,
                                         z + (r + 0.02) * math.sin(2 * math.pi * k / teeth)),
                      (0, -2 * math.pi * k / teeth, 0), t, 0.008) for k in range(teeth)]
    elif kind == "person":
        o += [ball(0.2, (0, 0, 0.2), b, 32, 16, scale=(1, 0.8, 0.9)),
              ball(0.11, (0, 0, 0.5), b, 32, 16),
              ring(0.2, 0.014, (0, 0, 0.14), m=g, major=40, minor=6)]
    elif kind == "rack":
        o.append(box(0.36, 0.34, 0.66, (0, 0, 0.37), m=dk, bevel=0.025))
        for k in range(5):
            o += [box(0.3, 0.01, 0.09, (0, -0.17, 0.12 + 0.12 * k), m=mt, bevel=0.004),
                  box(0.12, 0.006, 0.012, (-0.06, -0.176, 0.12 + 0.12 * k), m=g, bevel=0.0),
                  ball(0.012, (0.1, -0.178, 0.12 + 0.12 * k), m=(rd if k == 4 else g), seg=8, rings=6)]
    elif kind == "page":
        o += [box(0.34, 0.03, 0.46, (0, 0.03 * k, 0.3), (math.radians(-10), 0, 0), b, 0.01) for k in range(2)]
        o += [box(0.24, 0.006, 0.02, (0, -0.02, 0.44 - 0.06 * k), (math.radians(-10), 0, 0), g, 0.002) for k in range(4)]
    elif kind == "cycle":
        o += [ring(0.22, 0.04, (0, 0, 0.32), (math.pi / 2, 0, 0), t, 40, 10, arc=0.8),
              cone(0.08, 0.0, 0.14, (0.2, 0, 0.44), (0, math.radians(35), 0), g, 20),
              ball(0.06, (0, 0, 0.32), g)]
    elif kind == "envelope":
        o += [box(0.52, 0.06, 0.34, (0, 0, 0.27), (math.radians(-8), 0, 0), b, 0.02),
              tube([(-0.25, -0.04, 0.42), (0, -0.05, 0.25), (0.25, -0.04, 0.42)], 0.015, g)]
    return o


# ── build ───────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
exported = []

for i, (lid, name, colour, kinds) in enumerate(LAYERS):
    z = ((N - 1) / 2 - i) * GAP
    P = palette(lid, colour)

    # the slab: frosted glass, with a lit glass panel on top
    slab = box(W, D, TH, m=mat(f"slab_{lid}", colour, alpha=0.42, rough=0.18, coat=1.0, emit=0.12, white=0.05),
               bevel=0.35, seg=6)
    slab.name = f"layer_{lid}"
    slab.data.name = slab.name
    kids = []
    kids.append(box(W - 0.6, D - 0.6, 0.02, (0, 0, TH / 2 + 0.012),
                    m=mat(f"panel_{lid}", colour, alpha=0.3, rough=0.06, coat=1.0, emit=0.25, white=0.3), bevel=0.2, seg=4))
    # anodised rim around the edge
    kids.append(tube(rounded_rect(W, D, 0.35, 0.0), 0.06, mat(f"rim_{lid}", colour, rough=0.2, metal=1.0, white=0.35),
                     closed=True, res=3))
    # circuit traces: every part is wired to a bus along the front, which runs to the edge
    ztr = TH / 2 + 0.03
    tr = []
    span = W - 1.4
    xs = [-span / 2 + span * j / max(1, len(kinds) - 1) for j in range(len(kinds))]
    for j, x in enumerate(xs):
        y = 0.55 if j % 2 else -0.55
        if y > 0:
            tr.append(tube([(x, y - 0.42, ztr), (x, -0.95, ztr), (x + 0.3, -1.25, ztr)], 0.012, P["glow"], res=1))
            tr.append(tube([(x, y + 0.42, ztr), (x, 1.6, ztr), (x - 0.3, 1.9, ztr)], 0.012, P["glow"], res=1))
        else:
            tr.append(tube([(x, y - 0.42, ztr), (x, -1.0, ztr), (x + 0.25, -1.25, ztr)], 0.012, P["glow"], res=1))
    tr.append(tube([(-W / 2 + 0.45, -1.25, ztr), (W / 2 - 0.45, -1.25, ztr)], 0.014, P["glow"], res=1))
    tr += [cyl(0.04, 0.02, (x, -1.25, ztr), m=P["white"], verts=12) for x in (-W / 2 + 0.45, W / 2 - 0.45)]
    kids.append(join(tr, f"traces_{lid}"))
    # the layer's name, lettered into the top face
    kids.append(text(name.upper(), 0.24, (-W / 2 + 0.45, -1.92, TH / 2 + 0.02),
                     mat("letters", 0xFFFFFF, rough=0.3, emit=1.4, emit_white=1.0, white=1.0)))

    for o in kids:
        o.parent = slab

    for j, kind in enumerate(kinds):
        c = join(part(kind, P), f"comp_{lid}_{j}")
        # Modelled small, shown larger: baked in, so the page's highlight pulse
        # (which scales the part) starts from 1.
        c.scale = (1.3, 1.3, 1.3)
        _apply(c)
        c.parent = slab
        c.location = (xs[j], 0.55 if j % 2 else -0.55, TH / 2)

    # light pipes down to the next slab, origin at the top so the page can stretch them
    if i < N - 1:
        L = GAP - TH
        for k, (cx, cy) in enumerate([(-W / 2 + 0.5, -D / 2 + 0.5), (W / 2 - 0.5, -D / 2 + 0.5),
                                      (-W / 2 + 0.5, D / 2 - 0.5), (W / 2 - 0.5, D / 2 - 0.5)]):
            core = cyl(0.022, L, (cx, cy, -TH / 2 - L / 2), m=mat(f"pipe_{lid}", colour, emit=2.4, emit_white=0.2), verts=8)
            sleeve = cyl(0.065, L, (cx, cy, -TH / 2 - L / 2),
                         m=mat("sleeve", 0xDDE6FF, alpha=0.16, rough=0.05, coat=1.0), verts=12)
            cap_t = cyl(0.1, 0.04, (cx, cy, -TH / 2 - 0.02), m=P["metal"], verts=12)
            cap_b = cyl(0.1, 0.04, (cx, cy, -TH / 2 - L + 0.02), m=P["metal"], verts=12)
            pipe = join([core, sleeve, cap_t, cap_b], f"conduit_{lid}_{k}")
            bpy.context.scene.cursor.location = (cx, cy, -TH / 2)
            bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
            pipe.parent = slab

    slab.location = (0, 0, z)
    exported.append(slab)

# the plinth the stack stands on
zb = ((N - 1) / 2 - (N - 1)) * GAP - 1.15
gold = mat("plinth_glow", 0xE3B96A, emit=5.0, emit_white=0.2)
pl = [box(W + 2.2, D + 2.0, 0.3, m=mat("plinth", 0x151923, rough=0.3, metal=0.7, coat=0.6), bevel=0.3, seg=6),
      tube(rounded_rect(W + 1.2, D + 0.9, 0.5, 0.17), 0.035, gold, closed=True),
      text("ROADASSIST BHARAT", 0.26, (-W / 2 - 0.2, -D / 2 - 0.2, 0.155), gold)]
plinth = join(pl, "plinth")
plinth.location = (0, 0, zb)
exported.append(plinth)

# ── export for the web ──────────────────────────────────────────────────────
bpy.ops.object.select_all(action="DESELECT")
for root in exported:
    root.select_set(True)
    for ch in root.children_recursive:
        ch.select_set(True)
glb = os.path.join(OUT, "layers.glb")
# Draco-compressed: 2.5 MB of geometry becomes a few hundred KB for a phone on
# a highway. The page's GLTFLoader decodes it with the vendored Draco decoder.
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_lights=False, export_cameras=False,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10,
                          export_draco_texcoord_quantization=10)
print("EXPORTED", glb, os.path.getsize(glb), "bytes")

if not (DO_STILL or DO_FILM):
    sys.exit(0)

# ── look development for the renders ────────────────────────────────────────
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wn["Background"].inputs["Color"].default_value = (0.0028, 0.0034, 0.0052, 1)
wn["Background"].inputs["Strength"].default_value = 1.0

floor = box(400, 400, 0.02, m=mat("floor", 0x07090D, rough=0.22, metal=0.4, coat=0.8), bevel=0)
floor.location = (0, 0, zb - 0.16)

for nm, loc, energy, size, col in [("key", (8, -9, 13), 1000, 8, 0xFFF1D6), ("rim", (-10, 10, 7), 1600, 7, 0x7FA6FF),
                                   ("fill", (13, 9, 5), 450, 5, 0xFFD39A), ("top", (0, 0, 16), 220, 10, 0xFFFFFF)]:
    ld = bpy.data.lights.new(nm, "AREA")
    ld.energy, ld.size, ld.color = energy, size, rgba(col)[:3]
    lo = bpy.data.objects.new(nm, ld)
    lo.location = loc
    scene.collection.objects.link(lo)
    lo.rotation_euler = lo.location.to_track_quat("Z", "Y").to_euler()

pivot = bpy.data.objects.new("pivot", None)
pivot.location = (0, 0, -0.2)
scene.collection.objects.link(pivot)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 35
cam_data.dof.use_dof = True
cam_data.dof.focus_object = pivot
cam_data.dof.aperture_fstop = 5.6
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (17.5, -20.5, 11.0)
cam.parent = pivot
scene.collection.objects.link(cam)
tr_c = cam.constraints.new("TRACK_TO")
tr_c.target, tr_c.track_axis, tr_c.up_axis = pivot, "TRACK_NEGATIVE_Z", "UP_Y"
scene.camera = cam

scene.render.engine = "BLENDER_EEVEE"
ee = scene.eevee
for attr, val in [("taa_render_samples", 128), ("use_raytracing", True), ("use_shadows", True),
                  ("fast_gi_method", "GLOBAL_ILLUMINATION"), ("ray_tracing_method", "SCREEN")]:
    try:
        setattr(ee, attr, val)
    except (AttributeError, TypeError):
        pass
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"


def add_bloom():
    """Glare in the compositor: EEVEE's own bloom went away in 4.2."""
    try:
        if hasattr(scene, "compositing_node_group"):          # Blender 5
            ng = bpy.data.node_groups.new("comp", "CompositorNodeTree")
            scene.compositing_node_group = ng
            ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            nodes, links = ng.nodes, ng.links
            rl = nodes.new("CompositorNodeRLayers")
            gl = nodes.new("CompositorNodeGlare")
            out = nodes.new("NodeGroupOutput")
        else:
            scene.use_nodes = True
            nodes, links = scene.node_tree.nodes, scene.node_tree.links
            rl, gl = nodes["Render Layers"], nodes.new("CompositorNodeGlare")
            out = nodes["Composite"]
        for k, v in [("glare_type", "BLOOM"), ("quality", "HIGH"), ("threshold", 1.2), ("size", 7), ("mix", 0.0)]:
            try:
                setattr(gl, k, v)
            except (AttributeError, TypeError):
                pass
        for sock, v in [("Threshold", 1.4), ("Strength", 0.32), ("Size", 0.55)]:
            if sock in gl.inputs:
                gl.inputs[sock].default_value = v
        links.new(rl.outputs["Image"], gl.inputs["Image"])
        links.new(gl.outputs["Image"], out.inputs[0])
        print("BLOOM on")
    except Exception as e:  # a still without bloom is still a still
        print("BLOOM skipped:", e)


add_bloom()

if DO_STILL:
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1200
    scene.render.filepath = os.path.join(OUT, "layers-render.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)

if DO_FILM:
    # 10 s: the stack opens from stacked to exploded while the camera turns.
    fps, secs = 30, 8
    scene.render.fps = fps
    scene.frame_start, scene.frame_end = 1, fps * secs
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    ee.taa_render_samples = 32
    slabs = [o for o in exported if o.name.startswith("layer_")]
    for idx, sl in enumerate(slabs):
        z_open = ((N - 1) / 2 - idx) * GAP
        sl.location.z = z_open * 0.4
        sl.keyframe_insert("location", index=2, frame=1)
        sl.keyframe_insert("location", index=2, frame=30)
        sl.location.z = z_open
        sl.keyframe_insert("location", index=2, frame=90)
        # the pipes stretch with the gap, as they do on the page
        for ch in sl.children:
            if ch.name.startswith("conduit_"):
                ch.scale.z = (0.4 * GAP - TH) / (GAP - TH)
                ch.keyframe_insert("scale", index=2, frame=30)
                ch.scale.z = 1.0
                ch.keyframe_insert("scale", index=2, frame=90)
    pivot.rotation_euler = (0, 0, 0)
    pivot.keyframe_insert("rotation_euler", index=2, frame=1)
    pivot.rotation_euler = (0, 0, math.radians(-200))
    pivot.keyframe_insert("rotation_euler", index=2, frame=fps * secs)
    for fc in (pivot.animation_data.action.fcurves if pivot.animation_data and hasattr(pivot.animation_data.action, "fcurves") else []):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    frames_dir = os.path.join(OUT, "film_frames")
    os.makedirs(frames_dir, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(frames_dir, "f_")
    bpy.ops.render.render(animation=True)
    print("FILM FRAMES", frames_dir)
