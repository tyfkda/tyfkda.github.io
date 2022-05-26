class Vector2 {
  constructor(x, y) {
    this.x = x
    this.y = y
  }
}

// Ramer-Douglas-Peucker algorithm.
// https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm
function douglasPeucker(pointList, start, end, epsilon) {
  // Find the point with the maximum distance.
  const n = end - start
  let dmax = 0
  let index = (n >> 1) + start
  for (let i = start; ++i < end - 1; ) {
    let d = perpendicularDistance(pointList[i], pointList[start], pointList[end - 1])
    if (d > dmax) {
      index = i
      dmax = d
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (dmax > epsilon) {
    // Recursive call.
    const recResults1 = douglasPeucker(pointList, start, index + 1, epsilon)
    const recResults2 = douglasPeucker(pointList, index, end, epsilon)

    // Build the result list.
    for (let i = 1; i < recResults2.length; ++i)
      recResults1.push(recResults2[i])
    return recResults1
  } else {
    return [pointList[start], pointList[end - 1]]
  }
}

function perpendicularDistance(point, p, q) {
  const a = q.y - p.y
  const b = p.x - q.x
  const c = p.x * (p.y - q.y) - p.y * (p.x - q.x)
  return Math.abs(a * point.x + b * point.y + c) / Math.sqrt(a * a + b * b)
}

function setMouseDragListener(mouseMove, mouseUp, useCapture) {
  let mouseLeave = null
  let unlisten = null

  if (typeof mouseMove === 'object') {
    const option = mouseMove
    mouseMove = option.move
    mouseUp = option.up
    mouseLeave = option.leave
    useCapture = option.useCapture
  }

  const mouseUpDelegate = ($event) => {
    if (mouseUp)
      mouseUp($event)
    unlisten()
  }

  const mouseLeaveDelegate = (mouseLeave == null ? null : ($event) => {
    if (mouseLeave($event))
      unlisten()
  })

  unlisten = () => {
    document.removeEventListener('mousemove', mouseMove, useCapture)
    document.removeEventListener('touchmove', mouseMove, useCapture)
    document.removeEventListener('mouseup', mouseUpDelegate, useCapture)
    document.removeEventListener('touchend', mouseUpDelegate, useCapture)
    if (mouseLeaveDelegate) {
      document.removeEventListener('mouseleave', mouseLeaveDelegate, useCapture)
      document.removeEventListener('touchcancel', mouseLeaveDelegate, useCapture)
    }
  }

  document.addEventListener('mousemove', mouseMove, useCapture)
  document.addEventListener('touchmove', mouseMove, useCapture)
  document.addEventListener('mouseup', mouseUpDelegate, useCapture)
  document.addEventListener('touchend', mouseUpDelegate, useCapture)
  if (mouseLeaveDelegate) {
    document.addEventListener('mouseleave', mouseLeaveDelegate, useCapture)
    document.addEventListener('touchcancel', mouseLeaveDelegate, useCapture)
  }
}

function getMousePosition(event, canvas) {
  let clientX, clientY
  if (event.changedTouches) {
    const touch = event.changedTouches[0]
    clientX = touch.clientX
    clientY = touch.clientY
  } else {
    clientX = event.clientX
    clientY = event.clientY
  }
  const rect = canvas.getBoundingClientRect()
  return new Vector2(
    (clientX - rect.left) * canvas.width / rect.width,
    (clientY - rect.top) * canvas.height / rect.height)
}

const BG_COLOR = '#F8F8F8'

class App {
  constructor() {
    const canvas = document.getElementById('mycanvas')
    canvas.style.width = window.innerWidth + 'px'
    canvas.style.height = window.innerHeight + 'px'
    canvas.width = window.innerWidth * window.devicePixelRatio
    canvas.height = window.innerHeight * window.devicePixelRatio
    this.canvas = canvas

    this.context = canvas.getContext('2d')
    this.context.fillStyle = BG_COLOR
    this.context.fillRect(0, 0, canvas.width, canvas.height)
    this.context.lineWidth = window.devicePixelRatio

    this.strokes = []
    this.epsilon = 1

    const mouseDown = (event) => this.mouseDown(event)
    const passive = {passive: false}
    canvas.addEventListener('mousedown', mouseDown, passive)
    canvas.addEventListener('touchstart', mouseDown, passive)

    const text = document.getElementById('epsilon-text')
    const slider = document.getElementById('epsilon-slider')
    const COEFF = 20
    slider.addEventListener('input', (event) => {
      const value = Math.pow(slider.value / COEFF, 2)
      text.value = value.toString()
      this.setEpsilon(value)
    })
    text.addEventListener('change', (event) => {
      const value = Number(text.value)
      if (isNaN(value))
        return
      slider.value = Math.pow(value, 1 / 2) * COEFF
      this.setEpsilon(value)
    })
    slider.value = Math.pow(1, 1 / 2) * COEFF

    document.getElementById('clear').addEventListener('click', (_event) => {
      this.strokes.length = 0
      this.redraw()
    })

    this.showPoint = true
    document.getElementById('show-point').addEventListener('change', (event) => {
      this.showPoint = event.target.checked
      this.redraw()
    })
  }

  setEpsilon(value) {
    this.epsilon = value
    this.redraw()
  }

  mouseDown(event) {
    if (event.type === 'mousedown' && event.button !== 0)
      return
    event.preventDefault()

    const canvas = this.canvas
    const points = []
    let lastPos = getMousePosition(event, canvas)
    points.push(lastPos)

    const upFunc = (event) => {
      if (points.length >= 2)
        this.strokes.push(points)
      this.redraw()
      return true
    }

    setMouseDragListener({
      move: (event) => {
        const pos = getMousePosition(event, canvas)
        const context = this.context

        if (this.showPoint) {
          const S = window.devicePixelRatio
          context.strokeStyle = '#0F0'
          context.beginPath()
          context.rect(pos.x - 2 * S, pos.y - 2 * S, 5 * S, 5 * S)
          context.stroke()
        }

        context.strokeStyle = '#000'
        context.beginPath()
        context.moveTo(lastPos.x, lastPos.y)
        context.lineTo(pos.x, pos.y)
        context.stroke()
        lastPos = pos

        points.push(pos)
      },
      up: upFunc,
      leave: upFunc,
    })
  }

  redraw() {
    const canvas = this.canvas
    const context = this.context
    const S = window.devicePixelRatio
    context.fillStyle = BG_COLOR
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.lineWidth = S

    let count = 0, simplified_count = 0
    for (const points of this.strokes) {
      const simplified = this.epsilon > 0 ? douglasPeucker(points, 0, points.length, this.epsilon * S) : points
      count += points.length
      simplified_count += simplified.length

      if (this.showPoint) {
        context.strokeStyle = '#0F0'
        for (const pos of simplified) {
          context.beginPath()
          context.rect(pos.x - 2 * S, pos.y - 2 * S, 5 * S, 5 * S)
          context.stroke()
        }
      }

      context.strokeStyle = '#CCC'
      context.beginPath()
      points.forEach((pos, i) => {
        if (i === 0)
          context.moveTo(pos.x, pos.y)
        else
          context.lineTo(pos.x, pos.y)
      })
      context.stroke()

      context.strokeStyle = '#000'
      context.beginPath()
      simplified.forEach((pos, i) => {
        if (i === 0)
          context.moveTo(pos.x, pos.y)
        else
          context.lineTo(pos.x, pos.y)
      })
      context.stroke()
    }

    const per = count <= 0 ? '--' : Math.round(simplified_count * 10000 / count) / 100
    document.getElementById('info').value = `${per}% (#${simplified_count}/${count})`
  }
}

window.addEventListener('load', () => {
  new App()
})
