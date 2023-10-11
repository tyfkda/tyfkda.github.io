import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/+esm'
import {mat4} from 'https://wgpu-matrix.org/dist/2.x/wgpu-matrix.module.js'

const eulerZXY = (rx, ry, rz) => mat4.rotateY(mat4.rotateX(mat4.rotateZ(mat4.identity(), rz), rx), ry)

const WORKGROUP_SIZE = 8
const GRID_SIZE = 256

const DRAW_2D = '2d'
const DRAW_3D = '3d'

const PRESET_NONE = ''
const PRESET_CORAL = 'coral'
const PRESET_GIRAFFE = 'giraffe'
const PRESET_SPOT = 'spot'
const PRESET_MESH = 'mesh'
const PRESET_BACTERIA = 'bacteria'
const PRESET_NEON = 'neon'
const PRESET_BUCHI = 'buchi'

const PresetParameterTable = {
    coral: {     params: [1.0,  0.5,  0.055, 0.062], bgcolor: 0xAAC175, fgcolor: 0x101D35 },  // 珊瑚
    giraffe: {   params: [0.92, 0.5,  0.088, 0.057], bgcolor: 0xe1ddd3, fgcolor: 0x78452a },  // キリン
    spot: {      params: [1.0,  0.5,  0.026, 0.061], bgcolor: 0xD59E54, fgcolor: 0x2C1708 },  // ヒョウ
    mesh: {      params: [1.0,  0.5,  0.035, 0.057], bgcolor: 0x423C30, fgcolor: 0xE2E0CC },  // あみあみ
    bacteria: {  params: [0.9,  0.61, 0.023, 0.052], bgcolor: 0x962113, fgcolor: 0x1C0E11 },  // バクテリア
    neon: {      params: [0.80, 0.40, 0.082, 0.060], bgcolor: 0x1A2027, fgcolor: 0xC5E59B },  // ネオン
    buchi: {     params: [0.96, 0.53, 0.066, 0.061], bgcolor: 0xE8E6E0, fgcolor: 0x020202 },  // ブチ
}

class WgslFramework {
    checked = false

    async isSupported() {
        if (!this.checked) {
            if (navigator.gpu) {
                const adapter = await navigator.gpu.requestAdapter()
                if (adapter) {
                    this.device = await adapter.requestDevice()
                }
            }
            this.checked = true
        }
        return this.device != null
    }

    async setUpWgsl() {
        if (!await this.isSupported()) {
            throw new Error('WebGPU not supported on this browser.')
        }

        const canvas = document.querySelector('canvas')
        const context = canvas.getContext('webgpu')
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat()
        context.configure({
            device: this.device,
            format: canvasFormat,
        })

        this.canvas = canvas
        this.context = context
        this.canvasFormat = canvasFormat
    }
}

function frandom(min, max) {
    return Math.random() * (max - min) + min
}

function irandom(min, max) {
    return Math.floor(frandom(min, max))
}

async function fetchTextFile(path) {
    const response = await fetch(path)
    const text = await response.text()
    return text
}

class MyApp extends WgslFramework {
    page = 0
    drawPos = []
    drawMethod = DRAW_2D
    drawing = false

    async start() {
        await this.loadShaderCode()
        await this.setUpWgsl()

        this.setUpComputeData()
        this.setUpRenderingData()
        this.setUpSimulationPipelineData()
        this.setUpCellPipeline3DData()
        this.setUpCellPipeline2DData()

        this.setTouchEvents()
        this.startAnimation()
    }

    async loadShaderCode() {
        const shaderCodes = await Promise.all([
            fetchTextFile('reaction_diffusion_compute.wgsl'),
            fetchTextFile('reaction_diffusion_render_2d.wgsl'),
            fetchTextFile('reaction_diffusion_render_3d.wgsl'),
        ])
        this.shaderCodes = shaderCodes
    }

    setUpComputeData() {
        const BUFFER_SIZE = GRID_SIZE * GRID_SIZE * 4 * 4

        this.stagingBuffer = this.device.createBuffer({
            label: 'Staging buffer',
            size: BUFFER_SIZE,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        })

        const cellStateStorage = [
            this.device.createBuffer({
                label: 'Cell State A',
                size: BUFFER_SIZE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            }),
            this.device.createBuffer({
                label: 'Cell State B',
                size: BUFFER_SIZE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            }),
        ]

        const simulationShaderModule = this.device.createShaderModule({
            label: 'Game of Life simulation shader',
            code: this.shaderCodes[0],
        })

        this.cellStateStorage = cellStateStorage
        this.simulationShaderModule = simulationShaderModule

        this.randomizeCellState()
    }

    randomizeCellState() {
        const cellStateArray = new Float32Array(GRID_SIZE * GRID_SIZE * 4)

        for (let i = 0; i < cellStateArray.length; i += 4) {
            cellStateArray[i + 0] = 1.0
            cellStateArray[i + 1] = 0.0
            cellStateArray[i + 2] = 0.0
            cellStateArray[i + 3] = 1.0
        }
        const n = Math.floor(irandom(1, 32))
        for (let k = 0; k < n; ++k) {
            const size = Math.floor(irandom(2, 5))
            const x = Math.floor(irandom(size, GRID_SIZE - size))
            const y = Math.floor(irandom(size, GRID_SIZE - size))
            for (let i = -size; i <= size; ++i) {
                for (let j = -size; j <= size; ++j) {
                    const p = (((y + i) * GRID_SIZE) + (x + j)) * 4
                    cellStateArray[p + 0] = 0.5
                    cellStateArray[p + 1] = 0.5
                }
            }
        }

        this.device.queue.writeBuffer(this.cellStateStorage[0], 0, cellStateArray)
    }

    setUpRenderingData() {
        const vertices = new Float32Array([
            // float4 position, float4 UV

            // X-
            -1,  1,  1, 1,  0, 0,
            -1,  1, -1, 1,  1, 0,
            -1, -1,  1, 1,  0, 1,
            -1, -1, -1, 1,  1, 1,
            -1, -1,  1, 1,  0, 1,
            -1,  1, -1, 1,  1, 0,

            // Z-
            -1,  1, -1, 1,  0, 0,
             1,  1, -1, 1,  1, 0,
            -1, -1, -1, 1,  0, 1,
             1, -1, -1, 1,  1, 1,
            -1, -1, -1, 1,  0, 1,
             1,  1, -1, 1,  1, 0,

            // X+
             1,  1, -1, 1,   0, 0,
             1,  1,  1, 1,   1, 0,
             1, -1, -1, 1,   0, 1,
             1, -1,  1, 1,   1, 1,
             1, -1, -1, 1,   0, 1,
             1,  1,  1, 1,   1, 0,

            // Z+
             1,  1,  1, 1,   0, 0,
            -1,  1,  1, 1,   1, 0,
             1, -1,  1, 1,   0, 1,
            -1, -1,  1, 1,   1, 1,
             1, -1,  1, 1,   0, 1,
            -1,  1,  1, 1,   1, 0,

            // Y-
            -1, -1, -1, 1,  0, 0,
             1, -1, -1, 1,  1, 0,
            -1, -1,  1, 1,  0, 1,
             1, -1,  1, 1,  1, 1,
            -1, -1,  1, 1,  0, 1,
             1, -1, -1, 1,  1, 0,

            // Y+
            -1,  1,  1, 1,   0, 0,
             1,  1,  1, 1,   1, 0,
            -1,  1, -1, 1,   0, 1,
             1,  1, -1, 1,   1, 1,
            -1,  1, -1, 1,   0, 1,
             1,  1,  1, 1,   1, 0,
       ])

        const vertexBuffer = this.device.createBuffer({
            label: 'Cell vertices',
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        })
        this.device.queue.writeBuffer(vertexBuffer, 0, vertices)

        const vertexBufferLayout = {
            arrayStride: 6 * 4,
            attributes: [
                {  // Pos
                    format: 'float32x4',
                    offset: 0,
                    shaderLocation: 0,
                },
                {  // UV
                    format: 'float32x2',
                    offset: 4 * 4,
                    shaderLocation: 1,
                },
            ],
        }

        const cellShader2DModule = this.device.createShaderModule({
            label: 'Cell shader 2D',
            code: this.shaderCodes[1],
        })

        const cellShader3DModule = this.device.createShaderModule({
            label: 'Cell shader 3D',
            code: this.shaderCodes[2],
        })

        this.texture = this.device.createTexture({
            label: 'Cell texture',
            size: [GRID_SIZE, GRID_SIZE],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })

        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })

        const simulationUniform = new Float32Array([GRID_SIZE, GRID_SIZE, 1.0, 0.5, 0.055, 0.062])

        const simulationUniformBuffer = this.device.createBuffer({
            label: 'Uniform parameter',
            size: simulationUniform.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        this.device.queue.writeBuffer(simulationUniformBuffer, 0, simulationUniform)

        const cellUniform = new Float32Array(4 * 4 * 4 * 3)  // f32 4x4 matrix x 3 (projection, view, world)
        const cellUniformBuffer = this.device.createBuffer({
            label: 'Uniform parameter',
            size: cellUniform.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        this.device.queue.writeBuffer(cellUniformBuffer, 0, cellUniform)

        const materialUniform = new Float32Array([  // f32 4 vector x 2 (baseColor, cellColor)
            0xAA/255.0, 0xC1/255.0, 0x75/255.0, 1.0,
            0x10/255.0, 0x1D/255.0, 0x35/255.0, 1.0,
        ])
        const materialUniformBuffer = this.device.createBuffer({
            label: 'Uniform parameter',
            size: materialUniform.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        this.device.queue.writeBuffer(materialUniformBuffer, 0, materialUniform)

        this.vertices = vertices
        this.vertexBuffer = vertexBuffer
        this.vertexBufferLayout = vertexBufferLayout
        this.cellShader2DModule = cellShader2DModule
        this.cellShader3DModule = cellShader3DModule
        this.simulationUniform = simulationUniform
        this.simulationUniformBuffer = simulationUniformBuffer
        this.cellUniform = cellUniform
        this.cellUniformBuffer = cellUniformBuffer
        this.materialUniform = materialUniform
        this.materialUniformBuffer = materialUniformBuffer
    }

    setUpSimulationPipelineData() {
        const simulationPipeline = this.device.createComputePipeline({
            label: 'Simulation pipeline',
            layout: 'auto',
            compute: {
                module: this.simulationShaderModule,
                entryPoint: 'computeMain',
            },
        })

        const simulationBindGroupLayout = simulationPipeline.getBindGroupLayout(0)

        const simulationBindGroups = [
            this.device.createBindGroup({
                label: 'Simulation bind group A',
                layout: simulationBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.simulationUniformBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: this.cellStateStorage[0] },
                    },
                    {
                        binding: 2,
                        resource: { buffer: this.cellStateStorage[1] },
                    },
                ],
            }),
            this.device.createBindGroup({
                label: 'Simulation bind group B',
                layout: simulationBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.simulationUniformBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: this.cellStateStorage[1] },
                    },
                    {
                        binding: 2,
                        resource: { buffer: this.cellStateStorage[0] },
                    },
                ],
            }),
        ]

        this.simulationPipeline = simulationPipeline
        this.simulationBindGroups = simulationBindGroups
    }

    setUpCellPipeline3DData() {
        const sampler = this.device.createSampler({
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            // magFilter: 'linear',
            // minFilter: 'linear',
        })

        const cellBindGroupLayout = this.device.createBindGroupLayout({
            label: 'Cell Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'non-filtering' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'unfilterable-float' },
                },
            ],
        })

        const cellPipelineLayout = this.device.createPipelineLayout({
            label: 'Cell Pipeline Layout',
            bindGroupLayouts: [cellBindGroupLayout],
        })

        const cellPipeline = this.device.createRenderPipeline({
            label: 'Cell pipeline',
            layout: cellPipelineLayout,
            vertex: {
                module: this.cellShader3DModule,
                entryPoint: 'vertexMain',
                buffers: [this.vertexBufferLayout],
            },
            fragment: {
                module: this.cellShader3DModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: this.canvasFormat,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
        })

        const cellBindGroup = this.device.createBindGroup({
            label: 'Cell renderer bind group',
            layout: cellBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.cellUniformBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: this.materialUniformBuffer },
                },
                {
                    binding: 2,
                    resource: sampler,
                },
                {
                    binding: 3,
                    resource: this.texture.createView(),
                },
            ],
        })

        this.sampler = sampler
        this.cellPipeline = cellPipeline
        this.cellBindGroup = cellBindGroup
    }

    setUpCellPipeline2DData() {
        const cellBindGroup2DLayout = this.device.createBindGroupLayout({
            label: 'Cell Bind Group 2D Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'non-filtering' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'unfilterable-float' },
                },
            ],
        })

        const cellPipeline2DLayout = this.device.createPipelineLayout({
            label: 'Cell Pipeline 2D Layout',
            bindGroupLayouts: [cellBindGroup2DLayout],
        })

        const cellPipeline2D = this.device.createRenderPipeline({
            label: 'Cell pipeline 2D',
            layout: cellPipeline2DLayout,
            vertex: {
                module: this.cellShader2DModule,
                entryPoint: 'vertexMain',
            },
            fragment: {
                module: this.cellShader2DModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: this.canvasFormat,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-strip',
                cullMode: 'back',
            },
        })

        const cellBindGroup2D = this.device.createBindGroup({
            label: 'Cell renderer bind group',
            layout: cellBindGroup2DLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.materialUniformBuffer },
                },
                {
                    binding: 1,
                    resource: this.sampler,
                },
                {
                    binding: 2,
                    resource: this.texture.createView(),
                },
            ],
        })

        this.cellPipeline2D = cellPipeline2D
        this.cellBindGroup2D = cellBindGroup2D
    }

    draw() {
        if (this.drawing)
            return
        this.drawing = true

        this.getTransformationMatrix(this.cellUniformBuffer)

        const encoder = this.device.createCommandEncoder()

        for (let i = 0; i < 8; ++i) {
            const computePass = encoder.beginComputePass()
            computePass.setPipeline(this.simulationPipeline)
            computePass.setBindGroup(0, this.simulationBindGroups[this.page])
            const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE)
            computePass.dispatchWorkgroups(workgroupCount, workgroupCount)
            computePass.end()

            this.page = 1 - this.page
        }

        encoder.copyBufferToTexture(
            {
                buffer: this.cellStateStorage[this.page],
                bytesPerRow: GRID_SIZE * 4 * 4,
            },
            {texture: this.texture},
            {
                width: GRID_SIZE,
                height: GRID_SIZE,
                depthOrArrayLayers: 1,
            },
        )

        switch (this.drawMethod) {
        case DRAW_2D:
            {
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view: this.context.getCurrentTexture().createView(),
                        loadOp: 'clear',
                        clearValue: { r: 0, g: 0, b: 0.2, a: 1.0 },
                        storeOp: 'store',
                    }],
                })
                pass.setPipeline(this.cellPipeline2D)
                pass.setBindGroup(0, this.cellBindGroup2D)
                pass.draw(4)
                pass.end()
            }
            break
        case DRAW_3D:
            {
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view: this.context.getCurrentTexture().createView(),
                        loadOp: 'clear',
                        clearValue: { r: 0, g: 0, b: 0.2, a: 1.0 },
                        storeOp: 'store',
                    }],
                    depthStencilAttachment: {
                        view: this.depthTexture.createView(),
                        depthClearValue: 1.0,
                        depthLoadOp: 'clear',
                        depthStoreOp: 'store',
                    },
                })
                pass.setPipeline(this.cellPipeline)
                pass.setBindGroup(0, this.cellBindGroup)
                pass.setVertexBuffer(0, this.vertexBuffer)
                pass.draw(this.vertices.length / 6)
                pass.end()
            }
            break
        }

        if (this.drawPos.length > 0) {
            const output = this.cellStateStorage[this.page]
            encoder.copyBufferToBuffer(
                output,
                0, // Source offset
                this.stagingBuffer,
                0, // Destination offset
                this.stagingBuffer.size,
            )
        }

        this.device.queue.submit([encoder.finish()])

        if (this.drawPos.length <= 0) {
            this.drawing = false
        } else {
            this.runErase()
                .then(() => this.drawing = false)
        }
    }

    getTransformationMatrix(uniformBuffer) {
        const fovy = 45 * Math.PI / 180
        const aspect = this.canvas.width / this.canvas.height
        const near = 0.1
        const far = 1000
        const projectionMatrix = mat4.perspective(fovy, aspect, near, far)
        this.device.queue.writeBuffer(
            uniformBuffer, 4 * 16 * 0,
            projectionMatrix.buffer, projectionMatrix.byteOffset, projectionMatrix.byteLength)

        const eye = [0, 0, -5]
        const target = [0, 0, 0]
        const up = [0, 1, 0]
        const viewMatrix = mat4.lookAt(eye, target, up)
        this.device.queue.writeBuffer(
            uniformBuffer, 4 * 16 * 1,
            viewMatrix.buffer, viewMatrix.byteOffset, viewMatrix.byteLength)

        const t = Date.now() / 6000
        const rx = t * 2
        const ry = t * 3
        const rz = t * 5

        const worldMatrix = eulerZXY(rx, ry, rz)
        this.device.queue.writeBuffer(
            uniformBuffer, 4 * 16 * 2,
            worldMatrix.buffer, worldMatrix.byteOffset, worldMatrix.byteLength)
      }


    async runErase() {
        const BUFFER_SIZE = this.stagingBuffer.size
        await this.stagingBuffer.mapAsync(
            GPUMapMode.READ,
            0, // Offset
            BUFFER_SIZE // Length
        )

        const copyArrayBuffer = this.stagingBuffer.getMappedRange(0, BUFFER_SIZE)
        const data = copyArrayBuffer.slice()
        this.stagingBuffer.unmap()
        const cellStateArray = new Float32Array(data)

        const width = GRID_SIZE
        const height = GRID_SIZE

        for (let i = 0; i < this.drawPos.length; i += 3) {
            const cx = this.drawPos[i]
            const cy = this.drawPos[i + 1]
            const erase = this.drawPos[i + 2]

            const radius = (erase ? GRID_SIZE / 32 : GRID_SIZE / 64) | 0
            const radius2 = radius * radius
            const x = cx | 0, y = cy | 0
            const dx0 = Math.max(-radius, -x), dy0 = Math.max(-radius, -y)
            const dx1 = Math.min(radius, width - 1 - x), dy1 = Math.min(radius, height - 1 - y)
            for (let dy = dy0; dy <= dy1; ++dy) {
                for (let dx = dx0; dx <= dx1; ++dx) {
                    if (dx * dx + dy * dy >= radius2)
                        continue
                    const i = ((y + dy) * GRID_SIZE + (x + dx)) * 4
                    if (erase) {
                        cellStateArray[i + 0] = 1.0  // a
                        cellStateArray[i + 1] = 0.0  // b
                    } else {
                        cellStateArray[i + 0] = 0.0  // a
                        cellStateArray[i + 1] = 1.0  // b
                    }
                }
            }
        }
        this.drawPos.length = 0

        this.device.queue.writeBuffer(this.cellStateStorage[this.page], 0, cellStateArray)
    }

    async pushDraw(cx, cy, erase) {
        this.drawPos.push(cx, cy, erase)
    }

    startAnimation() {
        const interval = () => {
            this.draw()
            requestAnimationFrame(interval)
        }
        requestAnimationFrame(interval)
    }

    setTouchEvents() {
        const canvas = this.canvas
        const mouseDown = (event) => {
            if (event.type === 'mousedown' && event.button !== 0)
                return
            const clientRect = canvas.getBoundingClientRect()
            const erase = (ev) => {
                let cx, cy
                if (ev.touches != null) {
                    const touch = ev.touches[0]
                    cx = touch.clientX - clientRect.x
                    cy = touch.clientY - clientRect.y
                    event.preventDefault()
                } else {
                    cx = ev.clientX - clientRect.x
                    cy = ev.clientY - clientRect.y
                }
                // console.log(`${cx}, ${cy}`)
                if (0 <= cx && cx < canvas.width && 0 <= cy && cy < canvas.height) {
                    this.pushDraw(cx * GRID_SIZE / clientRect.width, (clientRect.height - 1 - cy) * GRID_SIZE / clientRect.height, !ev.shiftKey)
                }
            }
            erase(event)

            const mousemove = (event) => {
                erase(event)
            }
            const mouseup = (_event) => {
                document.removeEventListener('mousemove', mousemove)
                document.removeEventListener('mouseup', mouseup)
                document.removeEventListener('touchmove', mousemove)
                document.removeEventListener('touchend', mouseup)
            }
            document.addEventListener('mousemove', mousemove)
            document.addEventListener('mouseup', mouseup)
            document.addEventListener('touchmove', mousemove)
            document.addEventListener('touchend', mouseup)
        }

        canvas.addEventListener('mousedown', mouseDown)
        canvas.addEventListener('touchstart', (event) => { event.preventDefault(); mouseDown(event) })
    }

    setDrawMethod(value) {
        this.drawMethod = value
    }

    setParameter(index, value) {
        this.preset = PRESET_NONE
        this.simulationUniform[index + 2] = value
        this.device.queue.writeBuffer(this.simulationUniformBuffer, 0, this.simulationUniform)
    }

    setColors(bgcolor, fgcolor) {
        const br = ((bgcolor >> 16) & 0xff) / 255.0
        const bg = ((bgcolor >>  8) & 0xff) / 255.0
        const bb = ( bgcolor        & 0xff) / 255.0
        const fr = ((fgcolor >> 16) & 0xff) / 255.0
        const fg = ((fgcolor >>  8) & 0xff) / 255.0
        const fb = ( fgcolor        & 0xff) / 255.0
        const materialUniform = new Float32Array([  // f32 4 vector x 2 (baseColor, cellColor)
            br, bg, bb, 1.0,
            fr, fg, fb, 1.0,
        ])
        this.device.queue.writeBuffer(this.materialUniformBuffer, 0, materialUniform)
    }
}

async function main() {
    const myapp = new MyApp()

    const supported = await myapp.isSupported()

    let settingPreset = null

    Alpine.data('initialData', () => ({
        supported,
        started: false,

        preset: PRESET_CORAL,
        presetOptions: [
            {value: PRESET_NONE, text: ''},
            {value: PRESET_CORAL, text: '珊瑚'},
            {value: PRESET_GIRAFFE, text: 'キリン'},
            {value: PRESET_SPOT, text: 'チーター'},
            {value: PRESET_MESH, text: '網目'},
            {value: PRESET_BACTERIA, text: 'バクテリア'},

            {value: PRESET_NEON, text: 'ネオン'},
            {value: PRESET_BUCHI, text: 'ブチ'},
        ],
        drawMethod: DRAW_2D,
        drawMethodOptions: [
            {value: DRAW_2D, text: '2D'},
            {value: DRAW_3D, text: '3D'},
        ],
        dA: 1.0,
        dB: 0.5,
        feed: 0.055,
        kill: 0.062,

        init() {
            this.$watch('drawMethod', value => myapp.setDrawMethod(value))
            this.$watch('preset', value => this.setPreset(value))
            this.$watch('dA', value => this.setParameter(0, parseFloat(value)))
            this.$watch('dB', value => this.setParameter(1, parseFloat(value)))
            this.$watch('feed', value => this.setParameter(2, parseFloat(value)))
            this.$watch('kill', value => this.setParameter(3, parseFloat(value)))
        },

        async run() {
            this.started = true
            await myapp.start()
        },

        reset() {
            myapp.randomizeCellState()
        },

        setPreset(value) {
            if (value === PRESET_NONE)
                return

            settingPreset = value
            const {params, bgcolor, fgcolor} = PresetParameterTable[value]
            myapp.setParameter(0, this.dA = params[0].toFixed(2))
            myapp.setParameter(1, this.dB = params[1].toFixed(2))
            myapp.setParameter(2, this.feed = params[2].toFixed(3))
            myapp.setParameter(3, this.kill = params[3].toFixed(3))
            myapp.setColors(bgcolor, fgcolor)
            // Turn off when Alpine fixed the change events.
            setTimeout(() => settingPreset = null, 250)  // Wait for the parameter change
        },

        setParameter(index, value) {
            if (settingPreset === this.preset)
                return
            myapp.setParameter(index, value)
            this.preset = PRESET_NONE
        },
    }))
}

await main()

window.Alpine = Alpine
Alpine.start()
