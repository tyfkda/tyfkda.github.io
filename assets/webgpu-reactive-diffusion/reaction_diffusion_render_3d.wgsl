struct Uniform {
  projectionMatrix : mat4x4<f32>,
  viewMatrix : mat4x4<f32>,
  worldMatrix : mat4x4<f32>,
}

struct Material {
    baseColor: vec4f,
    cellColor: vec4f,
}

@group(0) @binding(0) var<uniform> param: Uniform;
@group(0) @binding(1) var<uniform> material: Material;
@group(0) @binding(2) var cellSampler: sampler;
@group(0) @binding(3) var cellTexture: texture_2d<f32>;

struct VertexInput {
    @location(0) pos: vec4f,
    @location(1) uv: vec2f,
};

struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
	output.pos = param.projectionMatrix * param.viewMatrix * param.worldMatrix * input.pos;
    output.uv = input.uv;
    return output;
}

struct FragInput {
    @location(0) uv: vec2f,
};

@fragment
fn fragmentMain(input: FragInput) -> @location(0) vec4f {
    let tex = textureSample(cellTexture, cellSampler, input.uv);
    let t = clamp(tex.y * 3, 0.0, 1.0);
    return mix(material.baseColor, material.cellColor, t);
}
