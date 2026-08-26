"""Create a small neutral Blender scene for real DCC adapter verification."""

import os
import sys

import bpy


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)


def add_cube(name, location, hide_render=False):
    bpy.ops.mesh.primitive_cube_add(size=2, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.hide_render = hide_render
    return obj


def build(output_path):
    clear_scene()
    scene = bpy.context.scene
    scene.name = "NeutralShotStateFixture"
    scene.frame_start = 1
    scene.frame_end = 30
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 320
    scene.render.resolution_y = 180
    scene.render.resolution_percentage = 100
    scene.render.fps = 30

    world = bpy.data.worlds.new("NeutralWorld") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.04, 0.06, 0.09, 1.0)
    background.inputs["Strength"].default_value = 0.25

    add_cube("Subject", (0, 0, 0))
    add_cube("HiddenPanel", (3, 0, 0), hide_render=True)
    add_cube("PartlyOutside", (5, 0, 0))
    add_cube("BehindCamera", (0, -10, 3))

    hidden_collection = bpy.data.collections.new("HiddenCollection")
    hidden_collection.hide_render = True
    scene.collection.children.link(hidden_collection)
    hidden = add_cube("CollectionHiddenObject", (-3, 0, 0))
    for collection in list(hidden.users_collection):
        collection.objects.unlink(hidden)
    hidden_collection.objects.link(hidden)

    camera_data = bpy.data.cameras.new("CameraData")
    camera = bpy.data.objects.new("ShotCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = (0, -8, 3)
    camera.rotation_euler = (1.22173, 0, 0)
    camera_data.lens = 48
    camera.keyframe_insert(data_path="location", frame=1)
    camera.location.x = 2
    camera_data.lens = 55
    camera.keyframe_insert(data_path="location", frame=30)
    camera_data.keyframe_insert(data_path="lens", frame=30)
    camera_data.lens = 48
    camera_data.keyframe_insert(data_path="lens", frame=1)

    light_data = bpy.data.lights.new("KeyData", type="AREA")
    light_data.energy = 900
    light_data.color = (1.0, 0.8, 0.6)
    light = bpy.data.objects.new("KeyLight", light_data)
    light.location = (2, -3, 5)
    scene.collection.objects.link(light)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=output_path)


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 1:
        raise ValueError("expected output .blend path")
    build(os.path.abspath(arguments[0]))
