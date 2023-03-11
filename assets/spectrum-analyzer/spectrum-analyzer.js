const initialData = (() => {
  'use strick'

  const minHz = 20
  const maxHz = 20000
  const minHzVal = Math.log10(minHz)
  const maxHzVal = Math.log10(maxHz)

  class SpectrumAnalyzer {
    analyserNode = null  // AnalyserNode
    dataArray = null     // Buffer for FFT
    canvas = null        // Canvas
    xBinTable = null     // index of FFT-array for x

    constructor(audioCtx, canvas) {
      this.audioCtx = audioCtx
      this.canvas = canvas

      this.analyserNode = this.audioCtx.createAnalyser()

      this.setUpWork()
    }

    setUpWork() {
      const bufferLength = this.analyserNode.frequencyBinCount
      this.dataArray = new Uint8Array(bufferLength)

      const WIDTH = this.canvas.width
      this.peakAmplitude = [...Array(WIDTH)].map(_ => 0)
      this.peakFallVel = [...Array(WIDTH)].map(_ => 0)

      const sampleRate = this.analyserNode.context.sampleRate
      this.xBinTable = new Int32Array([...Array(WIDTH + 1)].map((_, i) => {
        const e = i / WIDTH * (maxHzVal - minHzVal) + minHzVal
        const freq = 10 ** e
        return (freq * bufferLength / (sampleRate * 0.5)) | 0
      }))
    }

    setFftSize(fftSize) {
      if (this.analyserNode.fftSize !== fftSize) {
        this.analyserNode.fftSize = fftSize
        this.setUpWork()
      }
    }

    connectFrom(source) {
      source.connect(this.analyserNode)
    }

    update() {
      const canvasCtx = this.canvas.getContext('2d')
      canvasCtx.fillStyle = 'rgb(0,0,0)'
      canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height)

      if (this.analyserNode.minDecibels >= this.analyserNode.maxDecibels)
        return

      const WIDTH = this.canvas.width
      const HEIGHT = this.canvas.height
      const scale = HEIGHT / 255
      const gravity = HEIGHT / (64 * 64)

      const dataArray = this.dataArray
      this.analyserNode.getByteFrequencyData(dataArray)

      for (let i = 0; i < WIDTH; ++i) {
        // Bar.
        let bin = this.xBinTable[i]
        let v = dataArray[bin]
        for (const nextBin = this.xBinTable[i + 1]; ++bin < nextBin; )
          v = Math.max(v, dataArray[bin])

        const h = (v * scale) | 0
        const x = i
        canvasCtx.fillStyle = `rgb(${v>>2},${v},${160-(v>>1)})`
        canvasCtx.fillRect(x, HEIGHT - h, 1, h)

        // Peak.
        let py = this.peakAmplitude[i]
        if (h >= py) {
          this.peakAmplitude[i] = h
          this.peakFallVel[i] = 0
        } else if (py > 0) {
          this.peakFallVel[i] -= gravity
          this.peakAmplitude[i] += this.peakFallVel[i]

          const v = (py / scale) | 0
          canvasCtx.fillStyle = `rgb(0,${(v>>2)+192},${v>>1})`
          canvasCtx.fillRect(x, HEIGHT - 1 - py, 1, 2)
        }
      }

      // Axis.
      const AxisTable = [
        {freq: 100, text: '100Hz'},
        {freq: 1000, text: '1kHz'},
        {freq: 10000, text: '10kHz'},
      ]
      canvasCtx.strokeStyle = 'rgb(255,255,255)'
      canvasCtx.setLineDash([2, 2])
      canvasCtx.font = '12px serif'
      for (let i = 0; i < AxisTable.length; ++i) {
        const {freq, text} = AxisTable[i]
        const e = Math.log10(freq)
        const x = (e - minHzVal) * WIDTH / (maxHzVal - minHzVal)
        canvasCtx.beginPath()
        canvasCtx.moveTo(x, 0)
        canvasCtx.lineTo(x, HEIGHT)
        canvasCtx.stroke()

        canvasCtx.fillStyle='rgb(255,255,64)'
        canvasCtx.fillText(text, x, HEIGHT)
      }
      canvasCtx.setLineDash([])
    }
  }

  const FftSizeOptions = [512, 1024, 2048, 4096, 8192, 16384]

  const HideMenuX = 'translateX(100%)'
  const ShowMenuX = 'translateX(0)'

  return {
    maxDecibels: -30,
    minDecibels: -70,
    fftSize: 4096,
    FftSizeOptions,
    smoothing: 0.0,
    playing: false,
    menuX: HideMenuX,

    audioCtx: null,
    spectrumAnalyzer: null,
    audioSource: null,
    rafId: null,    // requestAnimationFrame
    audioElement: null,

    init() {
      const canvas = document.getElementById('mycanvas')
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
      const canvasCtx = canvas.getContext('2d')
      canvasCtx.fillStyle = 'rgb(0,0,0)'
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height)

      this.audioElement = document.getElementById('audio-player')

      this.$watch('maxDecibels', value => {
        const val = parseInt(value)
        if (this.minDecibels >= val) {
          this.minDecibels = val - 1
          if (this.spectrumAnalyzer != null)
            this.spectrumAnalyzer.analyserNode.minDecibels = this.minDecibels
        }
        if (this.spectrumAnalyzer != null)
          this.spectrumAnalyzer.analyserNode.maxDecibels = val
      })
      this.$watch('minDecibels', value => {
        let val = parseInt(value)
        if (this.maxDecibels <= val) {
          this.maxDecibels = val--
          if (this.spectrumAnalyzer != null)
            this.spectrumAnalyzer.analyserNode.maxDecibels = this.maxDecibels
        }
        if (this.spectrumAnalyzer != null)
          this.spectrumAnalyzer.analyserNode.minDecibels = val
      })
      this.$watch('fftSize', value => {
        if (this.spectrumAnalyzer != null)
          this.spectrumAnalyzer.setFftSize(value)
      })
      this.$watch('smoothing', value => {
        if (this.spectrumAnalyzer != null)
          this.spectrumAnalyzer.analyserNode.smoothingTimeConstant = value
      })
    },
    toggleMenu() {
      this.menuX = (this.menuX === HideMenuX) ? ShowMenuX : HideMenuX
    },
    onFileChange(files) {
      if (files == null || files.length === 0)
        return
      this.stopAudio()

      if (this.audioCtx == null) {
        this.audioCtx = new AudioContext()

        const canvas = document.getElementById('mycanvas')
        this.spectrumAnalyzer = new SpectrumAnalyzer(this.audioCtx, canvas)
        this.spectrumAnalyzer.analyserNode.maxDecibels = this.maxDecibels
        this.spectrumAnalyzer.analyserNode.minDecibels = this.minDecibels
        this.spectrumAnalyzer.setFftSize(this.fftSize)
        this.spectrumAnalyzer.analyserNode.smoothingTimeConstant = this.smoothing

        this.audioSource = this.audioCtx.createMediaElementSource(this.audioElement)
        this.spectrumAnalyzer.connectFrom(this.audioSource)
        this.audioSource.connect(this.audioCtx.destination)
      }

      const fileBlob = files[0]
      this.audioElement.src = URL.createObjectURL(fileBlob)
      this.audioElement.play()

      this.playing = true
      this.startAnimation()
    },

    stopAudio() {
      this.audioElement.pause()
      this.audioElement.removeAttribute('src')
    },

    startAnimation() {
      if (this.rafId != null)
        return
      const loopFn = (_timestamp) => {
        this.spectrumAnalyzer.update()
        this.rafId = requestAnimationFrame(loopFn)
      }
      this.rafId = requestAnimationFrame(loopFn)
    },
    stopAnimation() {
      if (this.rafId != null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
    },
  }
})()
