struct VertexOutput {
    @builtin(position) Position: vec4<f32>,
}

@vertex
fn main(
    @builtin(vertex_index) VertexIndex : u32
) -> VertexOutput {
   var output : VertexOutput;

   const pos = array(
        vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
        vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
    );

    output.Position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
    return output;
}
