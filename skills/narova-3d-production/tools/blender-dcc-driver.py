"""Bounded Blender-side operations for Narova's optional 3D companion."""

import glob
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Quaternion, Vector


MAX_LIGHTS = 64
MAX_INVENTORY_ITEMS = 512


def write_result(path, value):
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(value, handle, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)


def configure_render(scene, workload):
    scene.render.resolution_x = int(workload["width"])
    scene.render.resolution_y = int(workload["height"])
    scene.render.resolution_percentage = 100
    scene.render.fps = int(workload["fps"])
    scene.render.image_settings.file_format = "PNG"
    engine = workload.get("engine")
    if engine:
        allowed = {"BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH", "CYCLES"}
        if engine not in allowed:
            raise ValueError("unsupported Blender render engine")
        try:
            scene.render.engine = engine
        except TypeError:
            aliases = {"BLENDER_EEVEE_NEXT": "BLENDER_EEVEE", "BLENDER_EEVEE": "BLENDER_EEVEE_NEXT"}
            if engine not in aliases:
                raise
            scene.render.engine = aliases[engine]


def rounded(value):
    return round(float(value), 6)


def vector_values(value):
    return [rounded(component) for component in value]


def bounded_names(values):
    names = sorted(values)
    return names[:MAX_INVENTORY_ITEMS], {
        "total": len(names),
        "truncated": len(names) > MAX_INVENTORY_ITEMS,
    }


def enabled_collection_names(scene):
    enabled = set()

    def visit_layer(layer_collection, parent_disabled=False):
        blocked = (parent_disabled or bool(layer_collection.exclude) or
                   bool(layer_collection.collection.hide_render))
        if not blocked:
            enabled.add(layer_collection.collection.name)
        for child in layer_collection.children:
            visit_layer(child, blocked)

    for view_layer in scene.view_layers:
        if view_layer.use:
            visit_layer(view_layer.layer_collection)
    return enabled


def render_enabled(obj, enabled_collections):
    linked = list(obj.users_collection)
    collection_enabled = not linked or any(collection.name in enabled_collections for collection in linked)
    return not bool(obj.hide_render) and collection_enabled


def world_bounds(obj, depsgraph):
    if not getattr(obj, "bound_box", None):
        return None
    evaluated = obj.evaluated_get(depsgraph)
    points = [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
    if not points:
        return None
    return {
        "min": [rounded(min(point[index] for point in points)) for index in range(3)],
        "max": [rounded(max(point[index] for point in points)) for index in range(3)],
    }


def camera_projection(scene, obj, depsgraph):
    camera = scene.camera
    if camera is None:
        return {"available": False, "reason": "no-active-camera"}
    if camera.type != "CAMERA":
        return {"available": False, "reason": "active-object-is-not-camera"}
    if not getattr(obj, "bound_box", None):
        return {"available": False, "reason": "object-has-no-bounds", "camera": camera.name}
    evaluated = obj.evaluated_get(depsgraph)
    points = [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
    if not points:
        return {"available": False, "reason": "object-has-no-bounds", "camera": camera.name}
    projected = [world_to_camera_view(scene, camera, point) for point in points]
    in_front = [point for point in projected if point.z > 0]
    behind_count = len(projected) - len(in_front)
    if not in_front:
        return {
            "available": False,
            "reason": "no-bound-corners-in-front-of-camera",
            "camera": camera.name,
            "cornerCount": len(projected),
            "inFrontCornerCount": 0,
            "behindCameraCornerCount": behind_count,
        }
    minimum_x = min(point.x for point in in_front)
    maximum_x = max(point.x for point in in_front)
    minimum_y = min(point.y for point in in_front)
    maximum_y = max(point.y for point in in_front)
    clipped_minimum_x = max(0.0, minimum_x)
    clipped_maximum_x = min(1.0, maximum_x)
    clipped_minimum_y = max(0.0, minimum_y)
    clipped_maximum_y = min(1.0, maximum_y)
    intersects = (clipped_maximum_x >= clipped_minimum_x and
                  clipped_maximum_y >= clipped_minimum_y)
    center_world = sum(points, Vector((0.0, 0.0, 0.0))) / len(points)
    center = world_to_camera_view(scene, camera, center_world)
    result = {
        "available": True,
        "camera": camera.name,
        "basis": "evaluated-world-bound-corners",
        "normalizedOrigin": "bottom-left",
        "cornerCount": len(projected),
        "inFrontCornerCount": len(in_front),
        "behindCameraCornerCount": behind_count,
        "normalizedBounds": {
            "min": [rounded(minimum_x), rounded(minimum_y)],
            "max": [rounded(maximum_x), rounded(maximum_y)],
        },
        "frameIntersection": {
            "intersects": intersects,
            "min": ([rounded(clipped_minimum_x), rounded(clipped_minimum_y)]
                    if intersects else None),
            "max": ([rounded(clipped_maximum_x), rounded(clipped_maximum_y)]
                    if intersects else None),
            "width": rounded(max(0.0, clipped_maximum_x - clipped_minimum_x)),
            "height": rounded(max(0.0, clipped_maximum_y - clipped_minimum_y)),
            "area": rounded(max(0.0, clipped_maximum_x - clipped_minimum_x) *
                            max(0.0, clipped_maximum_y - clipped_minimum_y)),
        },
        "center": {
            "normalized": [rounded(center.x), rounded(center.y)],
            "depth": rounded(center.z),
            "inFront": bool(center.z > 0),
        },
    }
    return result


def camera_state(scene):
    camera = scene.camera
    if camera is None:
        return {"available": False, "name": None}
    rotation = camera.matrix_world.to_quaternion()
    data = camera.data
    result = {
        "available": True,
        "name": camera.name,
        "position": vector_values(camera.matrix_world.translation),
        "rotationQuaternion": [rounded(rotation.w), rounded(rotation.x), rounded(rotation.y), rounded(rotation.z)],
        "projection": data.type,
        "clipStart": rounded(data.clip_start),
        "clipEnd": rounded(data.clip_end),
    }
    if hasattr(data, "lens"):
        result["lensMm"] = rounded(data.lens)
    if hasattr(data, "ortho_scale"):
        result["orthoScale"] = rounded(data.ortho_scale)
    return result


def light_state(scene, enabled_collections):
    lights = []
    for obj in sorted((item for item in scene.objects if item.type == "LIGHT"), key=lambda item: item.name):
        data = obj.data
        lights.append({
            "name": obj.name,
            "type": data.type,
            "energy": rounded(data.energy),
            "color": vector_values(data.color),
            "renderEnabled": render_enabled(obj, enabled_collections),
        })
    return {"items": lights[:MAX_LIGHTS], "total": len(lights), "truncated": len(lights) > MAX_LIGHTS}


def color_and_world_state(scene):
    view = scene.view_settings
    color = {
        "displayDevice": scene.display_settings.display_device,
        "viewTransform": view.view_transform,
        "look": view.look,
        "exposure": rounded(view.exposure),
        "gamma": rounded(view.gamma),
    }
    world = scene.world
    if world is None:
        return color, {"available": False}
    backgrounds = []
    if world.use_nodes and world.node_tree:
        for node in world.node_tree.nodes:
            if node.type != "BACKGROUND":
                continue
            backgrounds.append({
                "name": node.name,
                "strength": rounded(node.inputs["Strength"].default_value),
                "color": vector_values(node.inputs["Color"].default_value),
            })
    return color, {
        "available": True,
        "name": world.name,
        "useNodes": bool(world.use_nodes),
        "color": vector_values(world.color),
        "backgrounds": backgrounds[:16],
        "truncated": len(backgrounds) > 16,
    }


def sampled_scene_state(scene, frames, object_names):
    original_frame = scene.frame_current
    samples = []
    try:
        for frame in frames:
            scene.frame_set(int(frame))
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            enabled_collections = enabled_collection_names(scene)
            enabled_count = sum(1 for obj in scene.objects if render_enabled(obj, enabled_collections))
            objects = []
            for name in object_names:
                obj = scene.objects.get(name)
                if obj is None:
                    objects.append({"name": name, "present": False})
                    continue
                objects.append({
                    "name": name,
                    "present": True,
                    "type": obj.type,
                    "hideRender": bool(obj.hide_render),
                    "renderEnabled": render_enabled(obj, enabled_collections),
                    "worldBounds": world_bounds(obj, depsgraph),
                    "cameraProjection": camera_projection(scene, obj, depsgraph),
                })
            samples.append({
                "frame": int(frame),
                "camera": camera_state(scene),
                "renderObjects": {"enabled": enabled_count, "disabled": len(scene.objects) - enabled_count},
                "lights": light_state(scene, enabled_collections),
                "objects": objects,
            })
    finally:
        scene.frame_set(original_frame)
        bpy.context.view_layer.update()
    motion = []
    for previous, current in zip(samples, samples[1:]):
        first = previous["camera"]
        second = current["camera"]
        if not first.get("available") or not second.get("available") or first["name"] != second["name"]:
            motion.append({"fromFrame": previous["frame"], "toFrame": current["frame"], "available": False})
            continue
        position_delta = math.sqrt(sum((second["position"][index] - first["position"][index]) ** 2 for index in range(3)))
        q1 = Quaternion(first["rotationQuaternion"])
        q2 = Quaternion(second["rotationQuaternion"])
        q1.normalize()
        q2.normalize()
        angle = 2 * math.acos(min(1.0, max(0.0, abs(q1.dot(q2)))))
        motion.append({
            "fromFrame": previous["frame"],
            "toFrame": current["frame"],
            "available": True,
            "positionDelta": rounded(position_delta),
            "angleDeltaDegrees": rounded(math.degrees(angle)),
            "lensDeltaMm": rounded(second.get("lensMm", 0) - first.get("lensMm", 0)),
        })
    return samples, motion


def inspect_scene(scene, workload, inspection):
    color_management, world = color_and_world_state(scene)
    frames = workload.get("sampleFrames", [])
    object_names = inspection.get("objects", [])
    samples, camera_motion = sampled_scene_state(scene, frames, object_names) if frames else ([], [])
    cameras, camera_inventory = bounded_names(obj.name for obj in scene.objects if obj.type == "CAMERA")
    lights, light_inventory = bounded_names(obj.name for obj in scene.objects if obj.type == "LIGHT")
    collections, collection_inventory = bounded_names(collection.name for collection in bpy.data.collections)
    return {
        "scene": scene.name,
        "objects": len(scene.objects),
        "cameras": cameras,
        "lights": lights,
        "collections": collections,
        "inventory": {
            "cameras": camera_inventory,
            "lights": light_inventory,
            "collections": collection_inventory,
        },
        "frameRange": {"start": scene.frame_start, "end": scene.frame_end},
        "fps": scene.render.fps,
        "renderEngine": scene.render.engine,
        "activeCamera": scene.camera.name if scene.camera else None,
        "colorManagement": color_management,
        "world": world,
        "sampleFrames": frames,
        "samples": samples,
        "cameraMotion": camera_motion,
    }


def render_sequence(scene, output_path, workload):
    os.makedirs(output_path, exist_ok=False)
    scene.frame_start = int(workload["startFrame"])
    scene.frame_end = int(workload["endFrame"])
    scene.render.filepath = os.path.join(output_path, "frame_")
    bpy.ops.render.render(animation=True)
    return sorted(os.path.basename(item) for item in glob.glob(os.path.join(output_path, "frame_*.png")))


def render_sparse_sequence(scene, output_path, frames):
    authored_start = int(scene.frame_start)
    authored_end = int(scene.frame_end)
    for frame in frames:
        if frame < authored_start or frame > authored_end:
            raise ValueError(f"sample frame {frame} is outside authored scene range {authored_start}..{authored_end}")
    os.makedirs(output_path, exist_ok=False)
    for frame in frames:
        scene.frame_set(int(frame))
        scene.render.filepath = os.path.join(output_path, f"frame_{int(frame):04d}.png")
        bpy.ops.render.render(write_still=True)
    return sorted(os.path.basename(item) for item in glob.glob(os.path.join(output_path, "frame_*.png")))


def run(operation, request):
    scene = bpy.context.scene
    workload = request["workload"]
    output_path = request.get("outputPath")
    runtime = {"blenderVersion": bpy.app.version_string, "background": bpy.app.background}
    if operation == "inspect-scene":
        return {"status": "succeeded", "runtime": runtime, "inspection": inspect_scene(scene, workload, request.get("inspection", {})), "kind": "scene-inspection", "determinismLimits": ["Blender version", "scene file"]}
    if operation == "export":
        if not output_path.lower().endswith(".blend"):
            raise ValueError("editable export must use a .blend destination")
        bpy.ops.wm.save_as_mainfile(filepath=output_path, copy=True)
        return {"status": "succeeded", "runtime": runtime, "kind": "blend-source", "payload": {"format": "blend", "editable": True}, "determinismLimits": ["Blender version"]}
    configure_render(scene, workload)
    if operation == "render-proof-still":
        start = int(workload["startFrame"])
        scene.frame_set(start)
        scene.render.filepath = output_path
        bpy.ops.render.render(write_still=True)
        return {"status": "succeeded", "runtime": runtime, "kind": "proof-still", "payload": {"frame": start}}
    if operation in {"render-proof-sequence", "render-final-shot"}:
        sample_frames = workload.get("sampleFrames")
        if sample_frames:
            files = render_sparse_sequence(scene, output_path, sample_frames)
            payload = {"sampleFrames": sample_frames, "frameCount": len(files)}
        else:
            start = int(workload["startFrame"])
            end = int(workload["endFrame"])
            files = render_sequence(scene, output_path, workload)
            payload = {"startFrame": start, "endFrame": end, "frameCount": len(files)}
        return {"status": "succeeded", "runtime": runtime, "kind": "image-frame", "payload": payload}
    raise ValueError("unsupported driver operation")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) != 3:
        raise ValueError("expected operation, request path, and result path")
    operation, request_path, result_path = argv
    try:
        with open(request_path, "r", encoding="utf-8") as handle:
            request = json.load(handle)
        result = run(operation, request)
    except Exception as error:
        result = {"status": "failed", "error": f"{type(error).__name__}: {error}"[:1024]}
    write_result(result_path, result)
    if result["status"] != "succeeded":
        raise RuntimeError(result["error"])


if __name__ == "__main__":
    main()
