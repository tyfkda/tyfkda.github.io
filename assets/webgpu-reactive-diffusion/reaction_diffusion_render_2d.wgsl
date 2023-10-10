struct Material {
    baseColor: vec4f,
    cellColor: vec4f,
}

@group(0) @binding(0) var<uniform> material: Material;
@group(0) @binding(1) var cellSampler: sampler;
@group(0) @binding(2) var cellTexture: texture_2d<f32>;

struct VertexInput {
    @location(0) pos: vec4f,
    @location(1) uv: vec2f,
};

struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};

const posTable = array<vec2f, 4>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0),
);

const uvTable = array<vec2f, 4>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
);

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
    var output: VertexOutput;
	output.pos = vec4f(posTable[vertexIndex], 0, 1);
    output.uv = uvTable[vertexIndex];
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
