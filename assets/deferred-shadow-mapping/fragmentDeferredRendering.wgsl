const kMaxNumLights = 64;
const SHADOW_Z_OFFSET = 0.001;  // 0.007;
const PI = 3.14159265359;

override shadowDepthTextureSize: f32 = 256.0;

@group(0) @binding(0) var gBufferNormal: texture_2d<f32>;
@group(0) @binding(1) var gBufferAlbedo: texture_2d<f32>;
@group(0) @binding(2) var gBufferDepth: texture_depth_2d;
@group(0) @binding(3) var shadowMap: texture_depth_2d_array;
@group(0) @binding(4) var shadowSampler: sampler_comparison;

struct Config {
    numLights : u32,
}
struct Camera {
    viewProjectionMatrix : mat4x4<f32>,
    invViewProjectionMatrix : mat4x4<f32>,
}
@group(1) @binding(0) var<uniform> config: Config;
@group(1) @binding(1) var<uniform> camera: Camera;

struct Light {
    viewProjMatrix: mat4x4<f32>,
    pos: vec3<f32>,
    color: vec3<f32>,
}

@group(2) @binding(0) var<uniform> lights : array<Light, kMaxNumLights>;

fn world_from_screen_coord(coord : vec2<f32>, depth_sample: f32) -> vec3<f32> {
    // reconstruct world-space position from the screen coordinate.
    let posClip = vec4(coord.x * 2.0 - 1.0, (1.0 - coord.y) * 2.0 - 1.0, depth_sample, 1.0);
    let posWorldW = camera.invViewProjectionMatrix * posClip;
    let posWorld = posWorldW.xyz / posWorldW.www;
    return posWorld;
}

struct FragmentInput {
    //@location(0) shadowPos : vec3<f32>,
    //@location(1) fragPos : vec3<f32>,
    //@location(2) fragNorm : vec3<f32>,

    @builtin(position) coord : vec4<f32>,
}

@fragment
fn main(
    input : FragmentInput
) -> @location(0) vec4<f32> {
    var total : vec3<f32> = vec3(0, 0, 0);

    for (var lightIndex = 0u; lightIndex < config.numLights; lightIndex += 1) {
        let light = lights[lightIndex];
        let depth = textureLoad(
            gBufferDepth,
            vec2<i32>(floor(input.coord.xy)),
            0
        );
        let hasPixel = select(0.0, 1.0, depth < 1.0);

        let bufferSize = textureDimensions(gBufferDepth);
        let coordUV = input.coord.xy / vec2<f32>(bufferSize);
        let position = world_from_screen_coord(coordUV, depth);

        let normal = textureLoad(
            gBufferNormal,
            vec2<i32>(floor(input.coord.xy)),
            0
        ).xyz;

        // XY is in (-1, 1) space, Z is in (0, 1) space
        let posFromLight0 = light.viewProjMatrix * vec4(position, 1.0);
        let posFromLight = posFromLight0.xyz / posFromLight0.w;
        let inSpotLight = select(0.0, 1.0, dot(posFromLight.xy, posFromLight.xy) < 1);

        // Convert XY to (0, 1)
        // Y is flipped because texture coords are Y-down.
        var shadowPos = vec3(
            posFromLight.xy * vec2(0.5, -0.5) + vec2(0.5),
            posFromLight.z
        );

        // Percentage-closer filtering. Sample texels in the region
        // to smooth the result.
        var visibility = 0.0;
        let oneOverShadowDepthTextureSize = 1.0 / shadowDepthTextureSize;
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let offset = vec2<f32>(vec2(x, y)) * oneOverShadowDepthTextureSize;
                visibility += textureSampleCompare(
                    shadowMap, shadowSampler,
                    shadowPos.xy + offset, lightIndex,
                    shadowPos.z - SHADOW_Z_OFFSET
                );
            }
        }
        visibility /= 9.0;

        let diff = light.pos - position;
        let invlen = inverseSqrt(dot(diff, diff));
        let lambertFactor = max(dot(diff * invlen, normal), 0.0);
        let decay = 1.0 / (4 * PI) * (invlen * invlen);
        let lightingFactor = visibility * lambertFactor * decay;

        let albedo = textureLoad(
            gBufferAlbedo,
            vec2<i32>(floor(input.coord.xy)),
            0
        ).rgb;

        total += hasPixel * inSpotLight * lightingFactor * light.color.rgb * albedo;
    }

    return vec4(total, 1.0);
}
