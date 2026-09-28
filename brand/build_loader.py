# CyberRevision loading animation: a vortex of light streaks spirals in and the logo pops out.
# Run headless:  Blender -b --python build_loader.py -- <out.blend> <frames_dir>
import bpy, math, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_BLEND = argv[0] if argv else '/tmp/loader.blend'
FRAMES_DIR = argv[1] if len(argv) > 1 else '/tmp/loader_frames/'

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- helpers ----------
def lin(hex_color, a=1.0):
    h = hex_color.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (a,)

def svg_pt(x, y):  # SVG 64x64 space (y down) -> scene units (2 units wide, y up)
    return ((x - 32) / 32, (32 - y) / 32)

def rot(points, deg, cx, cy):  # SVG rotate(deg cx cy), applied in SVG space
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in points]

def rounded_rect(x, y, w, h, r, seg=10):
    pts = []
    for cx, cy, a0 in ((x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def circle(cx, cy, r, seg=40):
    return [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]

def flat_mesh(name, svg_points, z, material, parent):
    verts = [(*svg_pt(x, y), 0) for x, y in svg_points]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [list(range(len(verts)))])
    ob = bpy.data.objects.new(name, me)
    ob.location.z = z
    ob.data.materials.append(material)
    ob.parent = parent
    coll.objects.link(ob)
    return ob

def emission(name, color, strength=1.0, blended=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = color
    em.inputs['Strength'].default_value = strength
    if blended:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])
        if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'
        m['mix'] = mix.name
    else:
        nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m

def ease(fcurves, interpolation='BEZIER', easing='AUTO'):
    for fc in fcurves:
        for k in fc.keyframe_points:
            k.interpolation = interpolation
            k.easing = easing

def fcurves_of(id_data):
    ad = id_data.animation_data
    if not ad or not ad.action: return []
    act = ad.action
    if hasattr(act, 'fcurves'):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out

# ---------- scene ----------
coll = bpy.data.collections.new('Loader')
scene.collection.children.link(coll)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.fps = 24
scene.frame_start, scene.frame_end = 1, 60
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.8
if hasattr(scene.eevee, 'taa_render_samples'): scene.eevee.taa_render_samples = 24
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.compression = 0
scene.render.filepath = FRAMES_DIR
if hasattr(scene.render, 'compositor_device'): scene.render.compositor_device = 'GPU'

world = bpy.data.worlds.new('World'); scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = lin('#0c0e1a')
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0

cam_data = bpy.data.cameras.new('Camera'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 4.2
cam = bpy.data.objects.new('Camera', cam_data); cam.location = (0, 0, 10); coll.objects.link(cam)
scene.camera = cam

# ---------- logo ----------
logo = bpy.data.objects.new('Logo', None); coll.objects.link(logo)

tile_mat = bpy.data.materials.new('Tile'); tile_mat.use_nodes = True
nt = tile_mat.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
tc = nt.nodes.new('ShaderNodeTexCoord'); dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
dot.inputs[1].default_value = (0.3536, -0.3536, 0)  # diagonal, scaled so the tile spans about 0..1
mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -0.5; mr.inputs['From Max'].default_value = 0.5
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = lin('#8b6cff'); ramp.color_ramp.elements[1].color = lin('#14b4dc')
mid = ramp.color_ramp.elements.new(0.5); mid.color = lin('#5a48f0')
nt.links.new(tc.outputs['Object'], dot.inputs[0]); nt.links.new(dot.outputs['Value'], mr.inputs['Value'])
nt.links.new(mr.outputs['Result'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
nt.links.new(em.outputs[0], out.inputs['Surface'])

white = emission('White', lin('#ffffff'), 1.0)
ghost = emission('Ghost', (0.55, 0.52, 1.0, 1), 1.0)
violet = emission('Violet', lin('#5a48f0'), 1.0)
cyan = emission('Cyan', lin('#14b4dc'), 1.4)

flat_mesh('Tile', rounded_rect(0, 0, 64, 64, 16), 0.00, tile_mat, logo)
flat_mesh('BackCard', rot(rounded_rect(11, 16, 30, 36, 6), -9, 26, 34), 0.02, ghost, logo)
flat_mesh('FrontCard', rot(rounded_rect(19, 14, 30, 37, 6), 7, 34, 33), 0.04, white, logo)

# circuit "C": centreline of M40.5 25 H33 a5 5 0 0 0 -5 5 v7 a5 5 0 0 0 5 5 h7.5, stroked 3.4 wide
line = [(40.5, 25), (33, 25)]
line += [(33 + 5 * math.cos(math.radians(a)), 30 + 5 * math.sin(math.radians(a))) for a in range(-90, -181, -10)]
line += [(28, 37)]
line += [(33 + 5 * math.cos(math.radians(a)), 37 + 5 * math.sin(math.radians(a))) for a in range(180, 89, -10)]
line += [(40.5, 42)]
clean = [line[0]]
for p in line[1:]:
    if math.dist(p, clean[-1]) > 1e-6: clean.append(p)
left, right = [], []
for i, p in enumerate(clean):
    a = clean[max(i - 1, 0)]; b = clean[min(i + 1, len(clean) - 1)]
    dx, dy = b[0] - a[0], b[1] - a[1]; n = math.hypot(dx, dy)
    nx, ny = -dy / n * 1.7, dx / n * 1.7
    left.append((p[0] + nx, p[1] + ny)); right.append((p[0] - nx, p[1] - ny))
stroke = rot(left + right[::-1], 7, 34, 33)
flat_mesh('Circuit', stroke, 0.06, violet, logo)
flat_mesh('NodeA', rot(circle(40.5, 25, 3), 7, 34, 33), 0.07, violet, logo)
flat_mesh('NodeB', rot(circle(40.5, 42, 3.6), 7, 34, 33), 0.07, cyan, logo)

spark = bpy.data.objects.new('Spark', None); spark.parent = logo; coll.objects.link(spark)
sx, sy = svg_pt(52, 11.2); spark.location = (sx, sy, 0.08)
star = [(52, 5.5), (53.7, 9.5), (57.7, 11.2), (53.7, 12.9), (52, 16.9), (50.3, 12.9), (46.3, 11.2), (50.3, 9.5)]
spark_ob = flat_mesh('SparkShape', [(x - 52 + 32, y - 11.2 + 32) for x, y in star], 0, emission('SparkWhite', (1, 1, 1, 1), 3.0), spark)

# Logo pop: twist in, overshoot, settle.
for f, s, r in ((30, 0.0, -140), (40, 1.12, 8), (45, 0.96, -2), (50, 1.0, 0)):
    logo.scale = (s, s, s); logo.rotation_euler.z = math.radians(r)
    logo.keyframe_insert('scale', frame=f); logo.keyframe_insert('rotation_euler', frame=f)
for f, s, r in ((1, 0, 0), (42, 0, 0), (47, 1.6, 45), (52, 1.0, 90), (60, 1.0, 110)):
    spark.scale = (s, s, s); spark.rotation_euler.z = math.radians(r)
    spark.keyframe_insert('scale', frame=f); spark.keyframe_insert('rotation_euler', frame=f)

# ---------- vortex ----------
palette = [lin('#8b6cff'), lin('#7c6bff'), lin('#14b4dc'), lin('#b9adff'), lin('#5ee0ff')]
mats = [emission(f'Streak{i}', c, 7.0) for i, c in enumerate(palette)]
base = bpy.data.meshes.new('StreakMesh')
import bmesh
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0); bm.to_mesh(base); bm.free()
base.materials.append(mats[0])

GOLDEN = math.pi * (3 - math.sqrt(5))
N = 320
for i in range(N):
    pivot = bpy.data.objects.new(f'Pivot{i}', None); coll.objects.link(pivot)
    streak = bpy.data.objects.new(f'Streak{i}', base); streak.parent = pivot; coll.objects.link(streak)
    streak.material_slots[0].link = 'OBJECT'; streak.material_slots[0].material = mats[i % len(mats)]
    start = 1 + int(random.random() * 18)
    arrive = 34 + int(random.random() * 7)
    r0 = 1.6 + random.random() * 1.9
    theta0 = i * GOLDEN
    turns = 1.4 + random.random() * 0.8
    thick = 0.007 + random.random() * 0.009
    length = 0.04 + random.random() * 0.07
    streak.rotation_euler.z = 0
    # appear
    streak.scale = (0, 0, 0); streak.keyframe_insert('scale', frame=start)
    streak.scale = (thick, length, thick); streak.keyframe_insert('scale', frame=start + 4)
    streak.keyframe_insert('scale', frame=arrive)
    streak.scale = (0, 0, 0); streak.keyframe_insert('scale', frame=arrive + 3)
    # spiral in: radius falls, spin accelerates
    streak.location = (r0, 0, 0.2); streak.keyframe_insert('location', frame=start)
    streak.location = (0.08, 0, 0.2); streak.keyframe_insert('location', frame=arrive)
    pivot.rotation_euler.z = theta0; pivot.keyframe_insert('rotation_euler', frame=start)
    pivot.rotation_euler.z = theta0 + turns * 2 * math.pi; pivot.keyframe_insert('rotation_euler', frame=arrive)
    ease(fcurves_of(streak), 'QUAD', 'EASE_IN')
    ease(fcurves_of(pivot), 'QUAD', 'EASE_IN')

# Shock ring when the logo lands.
ring_mat = emission('Ring', lin('#9d8cff'), 5.0, blended=True)
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.02, major_segments=96, minor_segments=8)
ring = bpy.context.active_object
for c in ring.users_collection: c.objects.unlink(ring)
coll.objects.link(ring)
ring.location.z = 0.3
ring.data.materials.append(ring_mat)
mix = ring_mat.node_tree.nodes[ring_mat['mix']]
for f, s, a in ((1, 0.001, 0), (37, 0.3, 0), (38, 0.35, 1), (50, 2.6, 0), (60, 2.6, 0)):
    ring.scale = (s, s, s); ring.keyframe_insert('scale', frame=f)
    mix.inputs['Fac'].default_value = a; mix.inputs['Fac'].keyframe_insert('default_value', frame=f)
ease(fcurves_of(ring), 'CUBIC', 'EASE_OUT')

# Centre glow that builds with the vortex.
core_mat = emission('Core', lin('#8f7dff'), 0.0)
core_em = core_mat.node_tree.nodes['Emission']
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=0.18, fill_type='NGON')
core = bpy.context.active_object
for c in core.users_collection: c.objects.unlink(core)
coll.objects.link(core); core.location.z = 0.15
core.data.materials.append(core_mat)
for f, v, s in ((1, 0, 0.2), (30, 8, 1.4), (38, 14, 2.2), (41, 0, 0.0)):
    core_em.inputs['Strength'].default_value = v; core_em.inputs['Strength'].keyframe_insert('default_value', frame=f)
    core.scale = (s, s, s); core.keyframe_insert('scale', frame=f)

# ---------- bloom (Blender 5.x compositor) ----------
tree = bpy.data.node_groups.new('LoaderComp', 'CompositorNodeTree')
scene.compositing_node_group = tree
rl = tree.nodes.new('CompositorNodeRLayers')
glare = tree.nodes.new('CompositorNodeGlare')
def set_input(node, name, value):
    if name in node.inputs:
        try: node.inputs[name].default_value = value
        except Exception: pass
set_input(glare, 'Type', 'Bloom'); set_input(glare, 'Quality', 'High')
set_input(glare, 'Threshold', 1.2); set_input(glare, 'Strength', 0.9); set_input(glare, 'Size', 0.7)
gout = tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
go = tree.nodes.new('NodeGroupOutput')
tree.links.new(rl.outputs['Image'], glare.inputs['Image'])
tree.links.new(glare.outputs['Image'], go.inputs[0])

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print('BUILT', len(scene.objects), 'objects ->', OUT_BLEND)
