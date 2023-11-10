const kMaxNumLights = 64;

override lightIndex: u32 = 0;

struct Light {
    viewProjMatrix: mat4x4<f32>,
    pos: vec3<f32>,
    color: vec3<f32>,
}

struct Model {
    modelMatrix: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> lights : array<Light, kMaxNumLights>;
@group(1) @binding(0) var<uniform> model : Model;

@vertex
fn main(
    @location(0) position: vec3<f32>
) -> @builtin(position) vec4<f32> {
    let light = lights[lightIndex];
    return light.viewProjMatrix * model.modelMatrix * vec4(position, 1.0);
}
