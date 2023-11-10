import {mat4, vec3, vec4} from 'https://wgpu-matrix.org/dist/2.x/wgpu-matrix.module.js'
import * as dat from 'https://cdn.jsdelivr.net/npm/dat.gui@0.7.9/build/dat.gui.module.js'
import {mesh} from './stanford-dragon.js'

const kMaxNumLights = 64;

const shadowDepthTextureSize = 512;

const upVector = vec3.fromValues(0, 1, 0);
const origin = vec3.fromValues(0, 0, 0);

function deg2rad(degree) {
    return degree * (Math.PI / 180)
}

function randomRange(min, max) {
    return Math.random() * (max - min) + min
}

function posNegRand(min, max) {
    const flag = Math.floor(Math.random() * 2) * 2 - 1
    return flag * randomRange(min, max)
}

function shuffle(array) {
    for (let i = 0; i < array.length - 1; ++i) {
        const r = Math.floor(Math.random() * (array.length - i)) + i
        const t = array[i]
        array[i] = array[r]
        array[r] = t
    }
    return array
}

class PointLight {
    constructor(lightColor) {
        const r = randomRange(100, 200)
        const t = randomRange(-Math.PI, Math.PI)
        this.lightPosition = vec3.fromValues(Math.sin(t) * r, 25 + Math.random() * 100, Math.cos(t) * r);
        this.lightColor = lightColor

        this.rx = posNegRand(deg2rad(60), deg2rad(90))
        this.ry = posNegRand(deg2rad(60), deg2rad(90))
    }

    update(device, sceneUniformBuffer, index, t, aspect) {
        const offset = (1 * 4 * 16 + 4 * 4 * 2) * index;

        const lightPosition = this.lightPosition

        const panMatrix = mat4.rotateY(
            mat4.rotateX(mat4.identity(), Math.sin(t * this.rx) * deg2rad(15)),
            Math.sin(t * this.ry) * deg2rad(15))

        const lightViewMatrix = mat4.lookAt(lightPosition, origin, upVector);
        let lightProjectionMatrix = (() => {
            return mat4.perspective(
                deg2rad(22.5),
                aspect,
                3,
                400.0
            );
        })();

        const lightViewProjMatrix = mat4.multiply(
            lightProjectionMatrix,
            mat4.multiply(panMatrix, lightViewMatrix))

        // The camera/light aren't moving, so write them into buffers now.
        const lightMatrixData = lightViewProjMatrix;
        device.queue.writeBuffer(
            sceneUniformBuffer,
            0 + offset,
            lightMatrixData.buffer,
            lightMatrixData.byteOffset,
            lightMatrixData.byteLength
        );

        const lightData = lightPosition;
        device.queue.writeBuffer(
            sceneUniformBuffer,
            64 + offset,
            lightData.buffer,
            lightData.byteOffset,
            lightData.byteLength
        );

        const lightColor = this.lightColor;
        device.queue.writeBuffer(
            sceneUniformBuffer,
            80 + offset,
            lightColor.buffer,
            lightColor.byteOffset,
            lightColor.byteLength
        );
    }
}

async function isWebGpuSupported() {
    let device = null
    if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter()
        if (adapter) {
            device = await adapter.requestDevice()
        }
    }
    return device
}

const init = async ({ device, canvas, gui }) => {
    const context = canvas.getContext('webgpu');

    let vertexWriteGBuffers
    let fragmentWriteGBuffers
    let vertexTextureQuad
    let fragmentGBuffersDebugView
    let fragmentDeferredRendering
    let vertexShadow

    await Promise.all([
        fetch('./vertexWriteGBuffers.wgsl').then((r) => r.text()).then((r) => vertexWriteGBuffers = r),
        fetch('./fragmentWriteGBuffers.wgsl').then((r) => r.text()).then((r) => fragmentWriteGBuffers = r),
        fetch('./vertexTextureQuad.wgsl').then((r) => r.text()).then((r) => vertexTextureQuad = r),
        fetch('./fragmentGBuffersDebugView.wgsl').then((r) => r.text()).then((r) => fragmentGBuffersDebugView = r),
        fetch('./fragmentDeferredRendering.wgsl').then((r) => r.text()).then((r) => fragmentDeferredRendering = r),
        fetch('./vertexShadow.wgsl').then((r) => r.text()).then((r) => vertexShadow = r),
    ])

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    const aspect = canvas.width / canvas.height;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
    });

    // Create the model vertex buffer.
    const kVertexStride = 8;
    const vertexBuffer = device.createBuffer({
        // position: vec3, normal: vec3, uv: vec2
        size:
            mesh.positions.length * kVertexStride * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    {
        const mapping = new Float32Array(vertexBuffer.getMappedRange());
        for (let i = 0; i < mesh.positions.length; ++i) {
            mapping.set(mesh.positions[i], kVertexStride * i);
            mapping.set(mesh.normals[i], kVertexStride * i + 3);
            mapping.set(mesh.uvs[i], kVertexStride * i + 6);
        }
        vertexBuffer.unmap();
    }

    // Create the model index buffer.
    const indexCount = mesh.triangles.length * 3;
    const indexBuffer = device.createBuffer({
        size: indexCount * Uint16Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true,
    });
    {
        const mapping = new Uint16Array(indexBuffer.getMappedRange());
        for (let i = 0; i < mesh.triangles.length; ++i) {
            mapping.set(mesh.triangles[i], 3 * i);
        }
        indexBuffer.unmap();
    }

    // GBuffer texture render targets
    const gBufferTexture2DFloat16 = device.createTexture({
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'rgba16float',
    });
    const gBufferTextureAlbedo = device.createTexture({
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'bgra8unorm',
    });
    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const vertexBuffers = [
        {
            arrayStride: Float32Array.BYTES_PER_ELEMENT * 8,
            attributes: [
                {
                    // position
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x3',
                },
                {
                    // normal
                    shaderLocation: 1,
                    offset: Float32Array.BYTES_PER_ELEMENT * 3,
                    format: 'float32x3',
                },
                {
                    // uv
                    shaderLocation: 2,
                    offset: Float32Array.BYTES_PER_ELEMENT * 6,
                    format: 'float32x2',
                },
            ],
        },
    ];

    const primitive = {
        topology: 'triangle-list',
        cullMode: 'back',
    };

    const writeGBuffersPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: vertexWriteGBuffers,
            }),
            entryPoint: 'main',
            buffers: vertexBuffers,
        },
        fragment: {
            module: device.createShaderModule({
                code: fragmentWriteGBuffers,
            }),
            entryPoint: 'main',
            targets: [
                // normal
                { format: 'rgba16float' },
                // albedo
                { format: 'bgra8unorm' },
            ],
        },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
        primitive,
    });

    const uniformBufferBindGroupLayout = device.createBindGroupLayout({
        label: 'uniformBufferBindGroupLayout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                },
            },
        ],
    });

    const gBufferTexturesBindGroupLayout = device.createBindGroupLayout({
        label: 'gBufferTexturesBindGroupLayout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'unfilterable-float',
                },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'unfilterable-float',
                },
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'depth',
                },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'depth',
                    viewDimension: '2d-array',
                },
            },
            {
                binding: 4,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                sampler: {
                    type: 'comparison',
                },
            },
        ],
    });

    const lightsBufferBindGroupLayout = device.createBindGroupLayout({
        label: 'lightsBufferBindGroupLayout',
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                },
            },
        ],
    });

    const gBuffersDebugViewPipeline = device.createRenderPipeline({
        label: 'gBuffersDebugViewPipeline',
        layout: device.createPipelineLayout({
            bindGroupLayouts: [gBufferTexturesBindGroupLayout],
        }),
        vertex: {
            module: device.createShaderModule({
                code: vertexTextureQuad,
            }),
            entryPoint: 'main',
        },
        fragment: {
            module: device.createShaderModule({
                code: fragmentGBuffersDebugView,
            }),
            entryPoint: 'main',
            targets: [
                {
                    format: presentationFormat,
                },
            ],
            constants: {
                canvasSizeWidth: canvas.width,
                canvasSizeHeight: canvas.height,
            },
        },
        primitive,
    });

    const deferredRenderPipeline = device.createRenderPipeline({
        label: 'deferredRenderPipeline',
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                gBufferTexturesBindGroupLayout,
                lightsBufferBindGroupLayout,
                uniformBufferBindGroupLayout,
            ],
        }),
        vertex: {
            module: device.createShaderModule({
                code: vertexTextureQuad,
            }),
            entryPoint: 'main',
        },
        fragment: {
            module: device.createShaderModule({
                code: fragmentDeferredRendering,
            }),
            entryPoint: 'main',
            targets: [
                {
                    format: presentationFormat,
                    // blend: {
                    //     color: {
                    //         srcFactor: 'one',
                    //         dstFactor: 'src-alpha',
                    //         operation: 'add',
                    //     },
                    //     alpha: {
                    //         srcFactor: 'src-alpha',
                    //         dstFactor: 'zero',
                    //         operation: 'add',
                    //     },
                    // },
                },
            ],
            constants: {
                shadowDepthTextureSize,
            },
        },
        primitive,
    });

    const textureQuadPassDescriptor = {
        colorAttachments: [
            {
                // view is acquired and set in render loop.
                view: undefined,

                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    };

    const settings = {
        mode: 'rendering',
        numLights: 6,
    };
    const configUniformBuffer = (() => {
        const buffer = device.createBuffer({
            size: Uint32Array.BYTES_PER_ELEMENT,
            mappedAtCreation: true,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        new Uint32Array(buffer.getMappedRange())[0] = settings.numLights;
        buffer.unmap();
        return buffer;
    })();

    gui.add(settings, 'mode', ['rendering', 'gBuffers view']);
    gui
        .add(settings, 'numLights', 1, kMaxNumLights)
        .step(1)
        .onChange(() => {
            device.queue.writeBuffer(
                configUniformBuffer,
                0,
                new Uint32Array([settings.numLights])
            );
        });

    const modelUniformBuffer = device.createBuffer({
        size: 4 * 16 * 2, // two 4x4 matrix
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const cameraUniformBuffer = device.createBuffer({
        size: 4 * 16 * 2, // two 4x4 matrix
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sceneUniformBindGroup = device.createBindGroup({
        layout: writeGBuffersPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: modelUniformBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: cameraUniformBuffer,
                },
            },
        ],
    });

    // VVV シャドウマップ関連 VVV

    // Create the depth texture for rendering/sampling the shadow map.
    const shadowDepthTexture = device.createTexture({
        size: [shadowDepthTextureSize, shadowDepthTextureSize, kMaxNumLights],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'depth32float',
    });

    const shadowPipelines = [...Array(kMaxNumLights)].map((_, i) => {
        return device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [
                    uniformBufferBindGroupLayout,
                    uniformBufferBindGroupLayout,
                ],
            }),
            vertex: {
                module: device.createShaderModule({
                    code: vertexShadow,
                }),
                entryPoint: 'main',
                buffers: vertexBuffers,
                constants: {
                    lightIndex: i,
                },
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth32float',
            },
            primitive,
        });
    })

    const modelBindGroup = device.createBindGroup({
        layout: uniformBufferBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: modelUniformBuffer,
                },
            },
        ],
    });

    const shadowPassDescriptors = [...Array(kMaxNumLights)].map((_, i) => {
        return {
            colorAttachments: [],
            depthStencilAttachment: {
                view: shadowDepthTexture.createView({arrayLayerCount: 1, baseArrayLayer: i}),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        };
    })

    const sceneUniformBuffer = device.createBuffer({
        // One 4x4 viewProj matrices for the light.
        // Then a vec3 for the light position.
        // Then a vec3 for the light color.
        // Rounded to the nearest multiple of 16.
        size: (1 * 4 * 16 + 4 * 4 * 2) * kMaxNumLights,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sceneBindGroupForShadow = device.createBindGroup({
        layout: uniformBufferBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: sceneUniformBuffer,
                },
            },
        ],
    });

    // ^^^ シャドウマップ関連 ^^^

    const gBufferTextureViews = [
        gBufferTexture2DFloat16.createView(),
        gBufferTextureAlbedo.createView(),
        depthTexture.createView(),
        shadowDepthTexture.createView(),
    ];

    const writeGBufferPassDescriptor = {
        colorAttachments: [
            {
                view: gBufferTextureViews[0],

                clearValue: { r: 0.0, g: 0.0, b: 1.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            },
            {
                view: gBufferTextureViews[1],

                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
        depthStencilAttachment: {
            view: depthTexture.createView(),

            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    };

    const gBufferTexturesBindGroup = device.createBindGroup({
        layout: gBufferTexturesBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: gBufferTextureViews[0],
            },
            {
                binding: 1,
                resource: gBufferTextureViews[1],
            },
            {
                binding: 2,
                resource: gBufferTextureViews[2],
            },
            {
                binding: 3,
                resource: gBufferTextureViews[3],
            },
            {
                binding: 4,
                resource: device.createSampler({
                    compare: 'less',
                })
            },
        ],
    });

    const lightsBufferBindGroup = device.createBindGroup({
        label: 'lightsBufferBindGroup',
        layout: lightsBufferBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: configUniformBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: cameraUniformBuffer,
                },
            },
        ],
    });


    const colors = shuffle([
        vec3.fromValues(1.0, 0.0, 0.0),
        vec3.fromValues(0.0, 1.0, 0.0),
        vec3.fromValues(0.0, 0.0, 1.0),
    ])
    const intensity = 200000
    const pointLights = [...Array(kMaxNumLights)].map((_, i) =>
        new PointLight(vec3.scale(colors[i % colors.length], intensity)))



    //--------------------

    // Scene matrices
    const eyePosition = vec3.fromValues(0, 50, -100);

    const projectionMatrix = mat4.perspective(
        (2 * Math.PI) / 5,
        aspect,
        1,
        2000.0
    );

    const viewMatrix = mat4.inverse(mat4.lookAt(eyePosition, origin, upVector));

    const viewProjMatrix = mat4.multiply(projectionMatrix, viewMatrix);

    // Move the model so it's centered.
    const modelMatrix = mat4.translation([0, -45, 0]);

    const modelData = modelMatrix;
    device.queue.writeBuffer(
        modelUniformBuffer,
        0,
        modelData.buffer,
        modelData.byteOffset,
        modelData.byteLength
    );
    const invertTransposeModelMatrix = mat4.invert(modelMatrix);
    mat4.transpose(invertTransposeModelMatrix, invertTransposeModelMatrix);
    const normalModelData = invertTransposeModelMatrix;
    device.queue.writeBuffer(
        modelUniformBuffer,
        64,
        normalModelData.buffer,
        normalModelData.byteOffset,
        normalModelData.byteLength
    );

    // Rotates the camera around the origin based on time.
    function getCameraViewProjMatrix(t) {
        const rad = t * (Math.PI / 10);
        const rotation = mat4.rotateY(mat4.translation(origin), rad);
        const rotatedEyePosition = vec3.transformMat4(eyePosition, rotation);

        const viewMatrix = mat4.lookAt(rotatedEyePosition, origin, upVector);

        mat4.multiply(projectionMatrix, viewMatrix, viewProjMatrix);
        return viewProjMatrix;
    }

    function frame() {
        // Sample is no longer the active page.

        const t = Date.now() * (1 / 1000);
        const cameraViewProj = getCameraViewProjMatrix(t);
        device.queue.writeBuffer(
            cameraUniformBuffer,
            0,
            cameraViewProj.buffer,
            cameraViewProj.byteOffset,
            cameraViewProj.byteLength
        );
        const cameraInvViewProj = mat4.invert(cameraViewProj);
        device.queue.writeBuffer(
            cameraUniformBuffer,
            64,
            cameraInvViewProj.buffer,
            cameraInvViewProj.byteOffset,
            cameraInvViewProj.byteLength
        );

        {
            const modelData = modelMatrix;
            device.queue.writeBuffer(
                modelUniformBuffer,
                0,
                modelData.buffer,
                modelData.byteOffset,
                modelData.byteLength
            );
        }

        for (let i = 0; i < settings.numLights; ++i) {
            const pointLight = pointLights[i]
            pointLight.update(device, sceneUniformBuffer, i, t, aspect)
        }

        const commandEncoder = device.createCommandEncoder();
        {
            // Write position, normal, albedo etc. data to gBuffers
            const gBufferPass = commandEncoder.beginRenderPass(
                writeGBufferPassDescriptor
            );
            gBufferPass.setPipeline(writeGBuffersPipeline);
            gBufferPass.setBindGroup(0, sceneUniformBindGroup);
            gBufferPass.setVertexBuffer(0, vertexBuffer);
            gBufferPass.setIndexBuffer(indexBuffer, 'uint16');
            gBufferPass.drawIndexed(indexCount);
            gBufferPass.end();
        }
        {
            //シャドウマップの描画
            for (let i = 0; i < settings.numLights; ++i) {
                const shadowPass = commandEncoder.beginRenderPass(shadowPassDescriptors[i]);
                shadowPass.setPipeline(shadowPipelines[i]);
                shadowPass.setBindGroup(0, sceneBindGroupForShadow);
                shadowPass.setBindGroup(1, modelBindGroup);
                shadowPass.setVertexBuffer(0, vertexBuffer);
                shadowPass.setIndexBuffer(indexBuffer, 'uint16');
                shadowPass.drawIndexed(indexCount);
                shadowPass.end();
            }

            if (settings.mode === 'gBuffers view') {
                // GBuffers debug view
                // Left: depth
                // Middle: normal
                // Right: albedo (use uv to mimic a checkerboard texture)
                textureQuadPassDescriptor.colorAttachments[0].view = context
                    .getCurrentTexture()
                    .createView();
                const debugViewPass = commandEncoder.beginRenderPass(textureQuadPassDescriptor);
                debugViewPass.setPipeline(gBuffersDebugViewPipeline);
                debugViewPass.setBindGroup(0, gBufferTexturesBindGroup);
                debugViewPass.draw(6);
                debugViewPass.end();
            } else {
                // Deferred rendering
                const view = context.getCurrentTexture().createView();
                textureQuadPassDescriptor.colorAttachments[0].view = view
                const deferredRenderingPass = commandEncoder.beginRenderPass(textureQuadPassDescriptor)
                deferredRenderingPass.setPipeline(deferredRenderPipeline);
                deferredRenderingPass.setBindGroup(0, gBufferTexturesBindGroup);
                deferredRenderingPass.setBindGroup(1, lightsBufferBindGroup);
                deferredRenderingPass.setBindGroup(2, sceneBindGroupForShadow);
                deferredRenderingPass.draw(6);
                deferredRenderingPass.end();
            }
        }
        device.queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

function notSupported() {
    const notSupported = document.getElementById('not-supported')
    notSupported.style.display = null  // デフォルト 'none' を削除して、表示する
}

function getUrlQueries() {
    const queryStr = window.location.search.slice(1)  // 文頭?を除外
    const queries = {}
    if (queryStr !== '') {
        queryStr.split('&').forEach((queryStr) => {
            var queryArr = queryStr.split('=')
            queries[queryArr[0]] = queryArr[1]
        })
    }
    return queries
}

async function main() {
    const device = await isWebGpuSupported()
    if (!device) {
        notSupported()
        return
    }

    const run = async () => {
        const canvas = document.createElement('canvas')
        canvas.style.width = canvas.style.height = '100%'
        document.body.appendChild(canvas)

        const gui = new dat.GUI();

        await init({device, canvas, gui})
    }

    // クエリ文字列で自動実行も可能にする
    const queries = getUrlQueries()
    if (queries.wait) {
        const ready = document.getElementById('ready')
        ready.style.display = null  // デフォルト 'none' を削除して、表示する
        ready.addEventListener('click', async () => {
            ready.style.display = 'none'  // 再度非表示に
            await run()
        })
    } else {
        await run()
    }
}

await main()
