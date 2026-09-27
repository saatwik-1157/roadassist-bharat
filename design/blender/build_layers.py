"""
RoadAssist Bharat - the seven-layer stack, modelled in Blender.

Builds the model the web page app/apps/web/layers.html shows, exports it as
glTF binary for three.js, and renders a still for the page's poster and the
decks. Run headless, so an open Blender window is left alone:

  blender -b --factory-startup -P design/blender/build_layers.py -- <out_dir>

Node names are the contract with the page: layer_<id> for a slab and
comp_<id>_<n> for a component on it (a child of its slab, so moving a slab
moves what sits on it). The page reads positions from the file, so layout
changes here need no change there.
"""
import math
import os
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.dirname(__file__)
os.makedirs(OUT, exist_ok=True)

# Same order, ids and colours as LAYERS in layers.html (top of the stack first).
LAYERS = [
    ("people", "People & devices", 0xE3B96A, 5),
    ("edge", "Offline edge", 0x3FB68B, 4),
    ("api", "API gateway", 0x4C8DFF, 5),
    ("domain", "Domain services", 0x9B7BFF, 5),
    ("data", "Data", 0x29B6C9, 4),
    ("ai", "AI", 0xFF7A59, 4),
    ("cloud", "Cloud & delivery", 0x8A93A6, 4),
]
W, D, TH = 7.4, 4.4, 0.22     # slab width, depth, thickness (metres = three.js units)
GAP = 1.75                    # exploded spacing; the page animates it from here


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hexv, mix_white=0.0):
    r, g, b = ((hexv >> 16) & 255) / 255, ((hexv >> 8) & 255) / 255, (hexv & 255) / 255
    r, g, b = (x + (1 - x) * mix_white for x in (r, g, b))
    return tuple(srgb_to_linear(x) for x in (r, g, b)) + (1.0,)


def material(name, hexv, *, alpha=1.0, rough=0.35, coat=0.0, emit=0.0, mix_white=0.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    col = rgb(hexv, mix_white)
    p.inputs["Base Color"].default_value = col
    p.inputs["Roughness"].default_value = rough
    p.inputs["Alpha"].default_value = alpha
    p.inputs["Coat Weight"].default_value = coat
    p.inputs["Coat Roughness"].default_value = 0.2
    p.inputs["Transmission Weight"].default_value = transmission
    p.inputs["Emission Color"].default_value = rgb(hexv)
    p.inputs["Emission Strength"].default_value = emit
    if alpha < 1.0:
        m.surface_render_method = "BLENDED"
    return m


def rounded_box(name, sx, sy, sz, bevel, segments, mat):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = bevel
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.harden_normals = False
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def comp_xy(j, n):
    """Components sit in a row across the slab, alternating front and back."""
    span = W - 1.4
    x = -span / 2 + span * j / max(1, n - 1)
    y = 0.55 if j % 2 else -0.55     # Blender +Y becomes glTF -Z
    return x, y


# ── clean scene ─────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

n = len(LAYERS)
for i, (lid, _name, colour, ncomp) in enumerate(LAYERS):
    z = ((n - 1) / 2 - i) * GAP
    # No transmission: in three.js it costs a second render pass, too much for a phone.
    slab_mat = material(f"slab_{lid}", colour, alpha=0.55, rough=0.28, coat=0.8, emit=0.08)
    slab = rounded_box(f"layer_{lid}", W, D, TH, 0.4, 6, slab_mat)
    slab.location = (0, 0, z)

    # An inset glass panel on top of each slab: reads as a "board" the parts sit on.
    top_mat = material(f"top_{lid}", colour, alpha=0.35, rough=0.12, coat=1.0, emit=0.15, mix_white=0.25)
    top = rounded_box(f"panel_{lid}", W - 0.5, D - 0.5, 0.03, 0.25, 4, top_mat)
    top.parent = slab
    top.location = (0, 0, TH / 2 + 0.01)

    comp_mat = material(f"comp_{lid}", colour, rough=0.38, coat=0.4, emit=0.35, mix_white=0.35)
    led_mat = material(f"led_{lid}", colour, emit=3.0, mix_white=0.5)
    for j in range(ncomp):
        x, y = comp_xy(j, ncomp)
        c = rounded_box(f"comp_{lid}_{j}", 1.0, 0.62, 0.26, 0.09, 4, comp_mat)
        c.parent = slab
        c.location = (x, y, TH / 2 + 0.16)
        # A lit strip on each part's face, like a status light on a rack unit.
        led = rounded_box(f"led_{lid}_{j}", 0.62, 0.04, 0.05, 0.015, 2, led_mat)
        led.parent = c
        led.location = (0, -0.32 if y < 0 else 0.32, 0.02)

# ── bake modifiers so the exported meshes carry the bevels ────────────────────
for ob in list(scene.objects):
    if ob.type == "MESH" and ob.modifiers:
        bpy.context.view_layer.objects.active = ob
        for mod in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)

glb = os.path.join(OUT, "layers.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_lights=False, export_cameras=False)
print("EXPORTED", glb, os.path.getsize(glb), "bytes")

# ── a still for the page's poster (and the decks) ────────────────────────────
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.0032, 0.0037, 0.0055, 1)
bg.inputs["Strength"].default_value = 1.0

# Big enough that its edge never enters the frame, and the same colour as the sky.
floor = rounded_box("floor", 400, 400, 0.02, 0.0, 1, material("floor", 0x0A0C11, rough=0.5))
floor.location = (0, 0, -((n - 1) / 2) * GAP - 1.2)

for name, loc, energy, size, colour in [
    ("key", (7, -8, 12), 1300, 8, 0xFFF3DD),
    ("rim", (-9, 9, 6), 1400, 6, 0x8FB2FF),
    ("fill", (10, 6, -2), 700, 4, 0xFFD9A8),
]:
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size
    ld.color = tuple(rgb(colour)[:3])
    lo = bpy.data.objects.new(name, ld)
    lo.location = loc
    scene.collection.objects.link(lo)
    direction = lo.location.copy()
    lo.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 35
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (17.5, -20.0, 11.5)
scene.collection.objects.link(cam)
target = bpy.data.objects.new("target", None)
target.location = (0, 0, 0.2)
scene.collection.objects.link(target)
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
scene.camera = cam

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1920
scene.render.resolution_y = 1200
scene.render.film_transparent = False
try:
    scene.eevee.taa_render_samples = 96
    scene.eevee.use_raytracing = True
except AttributeError:
    pass
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"

png = os.path.join(OUT, "layers-render.png")
scene.render.filepath = png
bpy.ops.render.render(write_still=True)
print("RENDERED", png)
