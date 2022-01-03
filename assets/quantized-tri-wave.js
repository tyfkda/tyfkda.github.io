const initialData = (() => {
  'use strick'

  function createQuantizedTriangleWave(div, N) {
    const an = new Array(N + 1)
    const bn = new Array(N + 1)
    an[0] = bn[0] = 0
    const coeff = 2 / (div - 1)
    for (let i = 1; i <= N; ++i) {
      let a = 0, b = 0
      function fa(x) { return 1 / (2 * i * Math.PI) *  Math.sin(2 * i * Math.PI * x) }
      function fb(x) { return 1 / (2 * i * Math.PI) * -Math.cos(2 * i * Math.PI * x) }
      for (let j = 0; j < div * 2; ++j) {
        const k = j < div ? 1 - j * coeff : -1 + (j - div) * coeff
        a += k * (fa((j + 1) / (2 * div)) - fa(j / (2 * div)))
        b += k * (fb((j + 1) / (2 * div)) - fb(j / (2 * div)))
      }
      an[i] = 2 * a
      bn[i] = 2 * b
    }
    return {an, bn}
  }

  function drawQuantizedWave(div, n) {
    const canvas = document.getElementById('mycanvas')
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const width = canvas.width
    const height = canvas.height

    const y0 = height * 0.5
    const h = -height * 0.4

    const {an, bn} = createQuantizedTriangleWave(div, n)

    ctx.beginPath()
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 1
    for (let i = 0; i <= width; ++i) {
      const x = i / width
      let y = 0
      for (let j = 0; j < n; ++j) {
        const t = x * (2 * j * Math.PI)
        y += an[j] * Math.cos(t) + bn[j] * Math.sin(t)
      }
      if (i === 0) ctx.moveTo(i, y * h + y0)
      else         ctx.lineTo(i, y * h + y0)
    }
    ctx.stroke()
  }

  function drawTriangleWave(div) {
    const canvas = document.getElementById('mycanvas')
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const width = canvas.width
    const height = canvas.height

    const y0 = height * 0.5
    const h = -height * 0.4

    ctx.beginPath()
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 1
    ctx.moveTo(0, h + y0)
    ctx.lineTo(width * 0.5, -h + y0)
    ctx.lineTo(width, h + y0)
    ctx.stroke()
  }

  function drawSquareWave(div) {
    const canvas = document.getElementById('mycanvas')
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const width = canvas.width
    const height = canvas.height

    const y0 = height * 0.5
    const h = -height * 0.4

    ctx.beginPath()
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 1
    ctx.moveTo(0, h + y0)
    ctx.lineTo(width * 0.25,  h + y0)
    ctx.lineTo(width * 0.25, -h + y0)
    ctx.lineTo(width * 0.75, -h + y0)
    ctx.lineTo(width * 0.75,  h + y0)
    ctx.lineTo(width       ,  h + y0)
    ctx.stroke()
  }

  function drawSineWave(div) {
    const canvas = document.getElementById('mycanvas')
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const width = canvas.width
    const height = canvas.height

    const y0 = height * 0.5
    const h = -height * 0.4

    ctx.beginPath()
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 1
    for (let i = 0; i <= width; ++i) {
      const x = i / width
      const y = Math.cos(x * (2 * Math.PI))
      if (i === 0) ctx.moveTo(i, y * h + y0)
      else         ctx.lineTo(i, y * h + y0)
    }
    ctx.stroke()
  }

  const audioCtx = new AudioContext()
  let oscillator = null

  const QUANTIZED = 'quantized'
  const TRIANGLE = 'triangle'
  const SQUARE = 'square'
  const SINE = 'sine'

  return {
    wave: 'quantized',
    playing: false,
    div: 16,
    n: 7,
    frequency: 220,
    init() {
      drawQuantizedWave(this.div, 1 << this.n)

      this.$watch('wave', value => {
        switch (value) {
        case QUANTIZED:
          drawQuantizedWave(this.div, 1 << this.n)
          break
        case TRIANGLE:
          drawTriangleWave()
          break
        case SQUARE:
          drawSquareWave()
          break
        case SINE:
          drawSineWave()
          break
        }
        if (this.playing) {
          this.stop()
          this.play()
        }
      })
      this.$watch('div', value => {
        drawQuantizedWave(value, 1 << this.n)
        if (this.playing) {
          this.setQuantizedWave(value, 1 << this.n)
        }
      })
      this.$watch('n', value => {
        drawQuantizedWave(this.div, 1 << value)
        if (this.playing) {
          this.setQuantizedWave(this.div, 1 << value)
        }
      })
      this.$watch('frequency', value => {
        if (oscillator != null)
          oscillator.frequency.setValueAtTime(value, audioCtx.currentTime)
      })
    },
    play() {
      oscillator = audioCtx.createOscillator()
      switch (this.wave) {
      case QUANTIZED:
        this.setQuantizedWave(this.div, 1 << this.n)
        break
      case TRIANGLE:
        oscillator.type = 'triangle'
        break
      case SQUARE:
        oscillator.type = 'square'
        break
      case SINE:
        oscillator.type = 'sine'
        break
      }
      oscillator.frequency.setValueAtTime(this.frequency, audioCtx.currentTime)
      oscillator.connect(audioCtx.destination)
      oscillator.start()

      this.playing = true
    },
    stop() {
      oscillator.stop()
      oscillator.disconnect()
      oscillator = null

      this.playing = false
    },
    setQuantizedWave(div, n) {
      const {an, bn} = createQuantizedTriangleWave(div, n)
      const wave = audioCtx.createPeriodicWave(an, bn)
      oscillator.setPeriodicWave(wave)
    }
  }
})()
