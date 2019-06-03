'use strict'

function updateGraph(dutyCycle, frequency, volume) {
  var canvas = document.getElementById('mycanvas')
  var ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  var unit = canvas.height / 2 * 0.95
  var w = canvas.width / unit
  var len = (100 * w) / frequency
  ctx.save()
  ctx.scale(unit, -unit)
  ctx.translate(0, -(canvas.height / 2) / unit)

  // Y axis.
  ctx.beginPath()
  ctx.strokeStyle = 'gray'
  ctx.lineWidth = 0.2 / unit
  ctx.moveTo(0, 0)
  ctx.lineTo(w, 0)
  ctx.stroke()

  // Positive sawtooth.
  ctx.strokeStyle = 'red'
  ctx.setLineDash([3 / unit, 3 / unit])
  ctx.lineWidth = 0.5 / unit
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (var i = 1; (i - 1) * len <= w; ++i) {
    ctx.lineTo(i * len, volume)
    ctx.lineTo(i * len, 0)
  }
  ctx.stroke()

  // Negative sawtooth.
  ctx.strokeStyle = 'blue'
  ctx.setLineDash([3 / unit, 3 / unit])
  ctx.lineWidth = 0.5 / unit
  var offset = -dutyCycle * len
  ctx.beginPath()
  ctx.moveTo(offset, 0)
  for (var i = 1; (i - 1) * len + offset <= w; ++i) {
    ctx.lineTo(i * len + offset, -volume)
    ctx.lineTo(i * len + offset, 0)
  }
  ctx.stroke()

  // Final output.
  ctx.strokeStyle = 'black'
  ctx.setLineDash([])
  ctx.lineWidth = 1 / unit
  var yh = (1.0 - dutyCycle) * volume
  var yl = yh - volume
  var offset = -dutyCycle * len
  ctx.beginPath()
  ctx.moveTo(0, yl)
  for (var i = 1; (i - 1) * len + offset <= w; ++i) {
    var x2 = i * len
    var x1 = x2 + offset
    ctx.lineTo(x1, yl)
    ctx.lineTo(x1, yh)
    ctx.lineTo(x2, yh)
    ctx.lineTo(x2, yl)
  }
  ctx.stroke()

  ctx.restore()
}

window.addEventListener('load', function() {
  var contextClass = window.AudioContext || window.webkitAudioContext
  if (contextClass == null) {
    console.error('WebAudio not supported')
    return
  }

  //  [／|／|]
  // oscillator ---------------+-> gain -> destination
  //   |   [＼|＼|]   [|＼|＼] |
  //   `-> inverter -> delay --'

  var context = new AudioContext()           // WebAudioのコンテキスト
  var frequency = 220                        // 鳴らす音程（周波数）
  var dutyCycle = 0.5                        // デューティ比
  var volume = 1.0                           // 音量
  var oscillator = null                      // ノコギリ波のオシレータ
  var gain = null                            // 音量ノード
  var delay = null                           // デューティ比用の遅延
  var audioNodes = []

  function createAudioNodes(context, destination) {
    oscillator = context.createOscillator()  // オシレータ（音源）
    oscillator.type = 'sawtooth'             // オシレータのタイプにノコギリ波を指定

    var inverter = context.createGain()      // ノコギリ波から矩形波を作成するための反転ノード
    inverter.gain.value = -1

    delay = context.createDelay()            // デューティ比再現用のディレイノード

    gain = context.createGain()              // 音量調整用ノード
    gain.gain.value = 1

    oscillator.connect(gain)                 // オシレータ->ゲイン
    oscillator.connect(inverter)             // オシレータ->反転
    inverter.connect(delay)                  // 反転->ディレイ
    delay.connect(gain)                      // ディレイ->ゲイン
    gain.connect(destination)                // ゲイン->出力

    audioNodes.push(oscillator, gain, delay, inverter)
  }

  function destroyAudioNodes() {
    audioNodes.forEach(function(node) { node.disconnect() })
    audioNodes.length = 0
    oscillator = delay = gain = null
  }

  function updateAudio() {
    if (oscillator != null)
      oscillator.frequency.value = frequency
    if (gain != null)
      gain.gain.value = volume
    if (delay != null)
      delay.delayTime.value = (1.0 - dutyCycle) / frequency
  }

  function update() {
    updateAudio()
    updateGraph(dutyCycle, frequency, volume)
  }

  function play() {
    createAudioNodes(context, context.destination)
    updateAudio()
    oscillator.start()

    document.querySelector('#play').disabled = true
    document.querySelector('#stop').disabled = false
  }

  function stop() {
    destroyAudioNodes()

    document.querySelector('#stop').disabled = true
    document.querySelector('#play').disabled = false
  }

  // UI
  document.querySelector('#duty-slider').addEventListener('input', function(event) {
    dutyCycle = event.target.value
    document.querySelector('#duty').value = dutyCycle
    update()
  })
  document.querySelector('#duty').addEventListener('change', function(event) {
    dutyCycle = event.target.value
    document.querySelector('#duty-slider').value = dutyCycle
    update()
  })
  document.querySelector('#play').addEventListener('click', play)
  document.querySelector('#stop').addEventListener('click', stop)

  var canvas = document.querySelector('#mycanvas')
  var mousedown = function(event) {
    if (event.type === 'mousedown' && event.button === 1)
      return

    var isTouch = event.type !== 'mousedown'
    var tweak = function(event) {
      event.preventDefault()
      event.stopPropagation()
      var rect = canvas.getBoundingClientRect()
      var px = isTouch ? event.changedTouches[0].pageX : event.pageX
      var py = isTouch ? event.changedTouches[0].pageY : event.pageY
      var x = Math.min(Math.max(0, px - rect.left), rect.width)
      var y = Math.min(Math.max(0, py - rect.top), rect.height)
      frequency = Math.min(100 / (x / (rect.width - 1)), 10000)
      volume = 1.0 - y / (rect.height - 1)
      update()
    }
    var move = function(event) {
      tweak(event)
    }
    var up = function() {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('touchmove', move, {passive: false})
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchend', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('touchmove', move, {passive: false})
    document.addEventListener('mouseup', up)
    document.addEventListener('touchend', up)
    tweak(event)
  }
  canvas.addEventListener('mousedown', mousedown)
  canvas.addEventListener('touchstart', mousedown)

  update()
})
