import {
  colorToHex,
  hexToHsl,
  hslToHex,
  getContrastColor,
  oklchToDisplayColor
} from './color-utils.js'
import {
  COLOR_VARS,
  CASCADE_MAP,
  TEXT_CONTRAST_MAP,
  THEME_FAMILIES,
  THEME_ICONS,
  THEME_ICON_MAP,
  GRADIENT_VARS,
  LOCAL_SERVER_URL
} from './config.js'

// ===== State =====
let currentTheme = 'light'
let currentVar = null
let modifications = {}
const originalValues = {}
let pickerOpen = false
let themeMode = 'advanced'

// ===== DOM Helpers =====
const $ = id => document.getElementById(id)
const $$ = sel => document.querySelectorAll(sel)
const $q = sel => document.querySelector(sel)

function getVarValue(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
}

// ===== Initialization =====
function init() {
  document.documentElement.setAttribute('data-theme-mode', themeMode)
  renderThemePicker()
  renderSwatches()
  renderCompactVars()
  setupClickHandlers()
  saveOriginalValues()
  updateThemePreview()
  renderGradientSection()
  updateModeToggle()
}

// ===== Theme Picker — compact swatch grid =====
function renderThemePicker() {
  const iconKey = THEME_ICON_MAP[currentTheme] || 'moon'
  const currentIcon = THEME_ICONS[iconKey] || THEME_ICONS.moon

  let html = `
    <button class="tp-toggle" onclick="editor.togglePicker()" aria-label="Choose theme" title="Choose theme">
      <span class="tp-toggle__icon">${currentIcon}</span>
      <span class="tp-toggle__label">${currentTheme}</span>
      <svg class="tp-toggle__caret ${pickerOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  `

  if (pickerOpen) {
    html += `
      <div class="tp-dropdown" onclick="event.stopPropagation()">
        ${THEME_FAMILIES.map(family => {
          const icon = THEME_ICONS[family.icon] || THEME_ICONS.moon
          const isLightActive = currentTheme === family.lightTheme
          const isDarkActive = currentTheme === family.darkTheme
          return `
            <div class="tp-family ${isLightActive || isDarkActive ? 'tp-family--active' : ''}">
              <div class="tp-family__label">${family.label}</div>
              <div class="tp-family__swatches">
                <button class="tp-swatch ${isLightActive ? 'tp-swatch--active' : ''}"
                  style="background: ${family.lightBg}; color: ${family.lightPrimary}; border-color: ${isLightActive ? family.lightPrimary : 'transparent'};"
                  onclick="editor.setTheme('${family.lightTheme}')"
                  title="${family.label} Light" aria-label="${family.label} Light">
                  <span class="tp-swatch__icon">${icon}</span>
                  <span class="tp-swatch__dot" style="background: ${family.lightPrimary};"></span>
                </button>
                <button class="tp-swatch ${isDarkActive ? 'tp-swatch--active' : ''}"
                  style="background: ${family.darkBg}; color: ${family.darkPrimary}; border-color: ${isDarkActive ? family.darkPrimary : 'transparent'};"
                  onclick="editor.setTheme('${family.darkTheme}')"
                  title="${family.label} Dark" aria-label="${family.label} Dark">
                  <span class="tp-swatch__icon">${icon}</span>
                  <span class="tp-swatch__dot" style="background: ${family.darkPrimary};"></span>
                </button>
              </div>
            </div>
          `
        }).join('')}
      </div>
      <div class="tp-overlay" onclick="editor.togglePicker()"></div>
    `
  }

  $('themePicker').innerHTML = html
}

function togglePicker() {
  pickerOpen = !pickerOpen
  renderThemePicker()
}

// ===== Rendering =====
function renderCompactVars() {
  const categories = [
    { name: 'Primary', vars: COLOR_VARS.primary },
    { name: 'Success', vars: COLOR_VARS.success },
    { name: 'Warning', vars: COLOR_VARS.warning },
    { name: 'Danger', vars: COLOR_VARS.danger },
    { name: 'Neutral', vars: COLOR_VARS.neutral },
    { name: 'Text', vars: COLOR_VARS.text },
    { name: 'Border', vars: COLOR_VARS.border },
    { name: 'Background', vars: COLOR_VARS.bg }
  ]

  const totalVars = categories.reduce((sum, c) => sum + c.vars.length, 0)
  $('totalVarsCount').textContent = `${totalVars} vars`

  $('compactVarsContainer').innerHTML = categories
    .map(
      cat => `
    <div class="compact-vars-section">
      <h4>${cat.name} <span class="count">(${cat.vars.length})</span></h4>
      <div class="compact-vars-grid">
        ${cat.vars
          .map(varName => {
            const shortName = varName.replace('--color-', '').replace('--hdk-', '')
            return `
            <div class="compact-var" data-var="${varName}" onclick="editor.openPanel('${varName}')">
              <div class="color-box" style="--swatch-color: var(${varName});"></div>
              <span class="var-name">${shortName}</span>
            </div>
          `
          })
          .join('')}
      </div>
    </div>
  `
    )
    .join('')
}

function renderSwatches() {
  Object.entries(COLOR_VARS).forEach(([category, vars]) => {
    const container = $(`${category}Swatches`)
    if (!container) return

    container.innerHTML = vars
      .map(
        varName => `
      <div class="swatch" data-var="${varName}" onclick="editor.openPanel('${varName}')">
        <div class="swatch-color" style="background: var(${varName});"></div>
        <div class="swatch-info">
          <div class="swatch-name">${varName.replace('--color-', '')}</div>
          <div class="swatch-value" id="val-${varName}">${getVarValue(varName)}</div>
        </div>
      </div>
    `
      )
      .join('')
  })
}

function updateThemePreview() {
  const primaryCard = $('previewCardPrimary')
  const hasAdvanced = !!GRADIENT_VARS[currentTheme]
  const showAdvanced = hasAdvanced && themeMode === 'advanced'

  $('themeNameBadge').textContent = currentTheme
  $('previewThemeName').textContent =
    currentTheme
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') + ' Theme'

  if (showAdvanced) {
    // Advanced theme: use gradient as preview card background
    primaryCard.className = 'preview-card-large gradient-preview'
    primaryCard.style.background = 'var(--advanced-gradient)'
    primaryCard.style.color = 'white'
    primaryCard.style.textShadow = '0 1px 3px rgba(0,0,0,0.3)'
  } else {
    // Simple mode or theme without advanced contract: solid primary background
    primaryCard.className = 'preview-card-large'
    primaryCard.style.background = 'var(--color-primary)'
    primaryCard.style.color = 'var(--color-on-primary)'
    primaryCard.style.textShadow = ''
  }

  // Update hover demo cards visibility
  const hoverDemo = $('hoverDemoSection')
  if (hoverDemo) {
    hoverDemo.style.display = showAdvanced ? '' : 'none'
  }
}

// ===== Gradient Section =====
function renderGradientSection() {
  const config = GRADIENT_VARS[currentTheme]
  const section = $('gradientSection')

  if (!config || themeMode === 'simple') {
    section.style.display = 'none'
    return
  }

  section.style.display = ''
  $('gradientStopCount').textContent = `${config.stops.length} stops`

  renderGradientBar()
  renderGradientStops(config)
}

function renderGradientBar() {
  const bar = $('gradientBar')
  bar.style.background = 'var(--advanced-gradient)'
}

// ===== Mode Toggle (Simple / Advanced) =====
function updateModeToggle() {
  const toggle = $('modeToggle')

  // Only show toggle for themes that ship an advanced visual contract
  if (!GRADIENT_VARS[currentTheme]) {
    toggle.style.display = 'none'
    return
  }

  toggle.style.display = ''
  $('modeBtnAdvanced').classList.toggle('active', themeMode === 'advanced')
  $('modeBtnSimple').classList.toggle('active', themeMode === 'simple')
}

function setMode(mode) {
  themeMode = mode === 'simple' ? 'simple' : 'advanced'
  document.documentElement.setAttribute('data-theme-mode', themeMode)
  updateModeToggle()
  updateThemePreview()
  renderGradientSection()
}

function renderGradientStops(config) {
  const container = $('gradientStopsContainer')

  container.innerHTML = config.stops
    .map((stop, i) => {
      const l = parseFloat(getVarValue(stop.vars.l)) || 0
      const c = parseFloat(getVarValue(stop.vars.c)) || 0
      const h = parseFloat(getVarValue(stop.vars.h)) || 0
      const hex = oklchToDisplayColor(l, c, h)

      return `
      <div class="gradient-stop-row" data-stop-index="${i}">
        <div class="gradient-stop-swatch" style="background: ${hex};" id="stopSwatch${i}"></div>
        <div class="gradient-stop-position">${stop.position}</div>
        <div class="gradient-stop-sliders">
          <div class="oklch-slider-group">
            <div class="oklch-slider-label"><span>L</span><span class="oklch-slider-value" id="stopL${i}">${l}</span></div>
            <input type="range" class="oklch-slider oklch-slider--l" min="0" max="1" step="0.01" value="${l}"
              oninput="editor.handleGradientSlider(${i}, 'l', this.value)">
          </div>
          <div class="oklch-slider-group">
            <div class="oklch-slider-label"><span>C</span><span class="oklch-slider-value" id="stopC${i}">${c}</span></div>
            <input type="range" class="oklch-slider oklch-slider--c" min="0" max="0.4" step="0.01" value="${c}"
              oninput="editor.handleGradientSlider(${i}, 'c', this.value)">
          </div>
          <div class="oklch-slider-group">
            <div class="oklch-slider-label"><span>H</span><span class="oklch-slider-value" id="stopH${i}">${h}</span></div>
            <input type="range" class="oklch-slider oklch-slider--h" min="0" max="360" step="1" value="${h}"
              oninput="editor.handleGradientSlider(${i}, 'h', this.value)">
          </div>
        </div>
      </div>
    `
    })
    .join('')
}

function handleGradientSlider(stopIndex, channel, value) {
  const config = GRADIENT_VARS[currentTheme]
  if (!config) return

  const stop = config.stops[stopIndex]
  const varName = stop.vars[channel]

  // Set the CSS variable
  document.documentElement.style.setProperty(varName, value)
  modifications[varName] = value

  // Update slider value label
  const labelId = `stop${channel.toUpperCase()}${stopIndex}`
  const label = $(labelId)
  if (label) label.textContent = value

  // Update swatch color
  const l = parseFloat(getVarValue(stop.vars.l)) || 0
  const c = parseFloat(getVarValue(stop.vars.c)) || 0
  const h = parseFloat(getVarValue(stop.vars.h)) || 0
  const hex = oklchToDisplayColor(l, c, h)
  const swatch = $(`stopSwatch${stopIndex}`)
  if (swatch) swatch.style.background = hex

  // Update gradient bar
  renderGradientBar()
  updateModCount()
}

function updateModCount() {
  const count = Object.keys(modifications).length
  const modBadge = $('modBadge')
  const modCount = $('modCount')
  const modCount2 = $('modCount2')

  modBadge.style.display = count > 0 ? 'inline' : 'none'
  modCount.textContent = count
  if (modCount2) {
    modCount2.style.display = count > 0 ? 'inline' : 'none'
    modCount2.textContent = count
  }

  const container = $('modifiedVars')
  if (count === 0) {
    container.innerHTML = `<div style="color: var(--color-text-muted); font-size: var(--hdk-text-xs); padding: var(--hdk-space-md);">No modifications yet</div>`
  } else {
    container.innerHTML = Object.entries(modifications)
      .map(
        ([varName, value]) => `
      <div class="var-item modified" onclick="editor.openPanel('${varName}')">
        <div class="color-dot" style="background: ${value};"></div>
        <span class="var-label">${varName.replace('--color-', '').replace('--advanced-', 'grad-')}</span>
      </div>
    `
      )
      .join('')
  }
}

function updateSwatchValue(varName, value) {
  const el = $(`val-${varName}`)
  if (el) el.textContent = value

  const swatch = $q(`.swatch[data-var="${varName}"]`)
  if (swatch) {
    swatch.classList.toggle('modified', !!modifications[varName])
    const colorDiv = swatch.querySelector('.swatch-color')
    if (colorDiv) colorDiv.style.background = value
  }

  const compactVar = $q(`.compact-var[data-var="${varName}"]`)
  if (compactVar) {
    compactVar.classList.toggle('modified', !!modifications[varName])
    const colorBox = compactVar.querySelector('.color-box')
    if (colorBox) colorBox.style.setProperty('--swatch-color', value)
  }
}

// ===== Theme Management =====
function setTheme(theme) {
  currentTheme = theme
  document.documentElement.setAttribute('data-theme', theme)
  pickerOpen = false
  themeMode = 'advanced'
  document.documentElement.setAttribute('data-theme-mode', 'advanced')

  Object.keys(modifications).forEach(varName => {
    document.documentElement.style.removeProperty(varName)
  })
  modifications = {}

  saveOriginalValues()
  renderThemePicker()
  renderSwatches()
  renderCompactVars()
  updateModCount()
  updateThemePreview()
  renderGradientSection()
  updateModeToggle()

  if (currentVar) updatePanelForVar(currentVar)
}

// ===== Color Variable Management =====
function setVar(varName, value, skipCascade = false) {
  document.documentElement.style.setProperty(varName, value)
  modifications[varName] = value
  updateModCount()
  updateSwatchValue(varName, value)

  if (!skipCascade && CASCADE_MAP[varName]) {
    const hexValue = colorToHex(value)
    const hsl = hexToHsl(hexValue)
    const isDark = currentTheme.includes('dark')

    Object.entries(CASCADE_MAP[varName]).forEach(([childVar, deriveFn]) => {
      const derived = deriveFn(hsl.h, hsl.s, hsl.l, isDark)
      let newColor
      if (derived.a !== undefined && derived.a < 100) {
        newColor = `hsla(${Math.round(derived.h)}, ${Math.round(derived.s)}%, ${Math.round(derived.l)}%, ${derived.a / 100})`
      } else {
        newColor = hslToHex(derived.h, derived.s, derived.l)
      }
      setVar(childVar, newColor, true)
    })
  }

  if (!skipCascade && TEXT_CONTRAST_MAP[varName]) {
    const textColor = getContrastColor(value)
    document.documentElement.style.setProperty(TEXT_CONTRAST_MAP[varName], textColor)
  }
}

// ===== Panel Management =====
function openPanel(varName) {
  currentVar = varName
  $('layout').classList.remove('panel-closed')
  $('editorPanel').classList.remove('hidden')

  $$('.swatch').forEach(s => s.classList.remove('selected'))
  const swatch = $q(`[data-var="${varName}"]`)
  if (swatch) swatch.classList.add('selected')

  highlightElementsUsingVar(varName)
  updatePanelForVar(varName)
}

function closePanel() {
  $('layout').classList.add('panel-closed')
  $('editorPanel').classList.add('hidden')
  $$('.swatch').forEach(s => s.classList.remove('selected'))
  clearHighlights()
  currentVar = null
}

function highlightElementsUsingVar(varName) {
  clearHighlights()
  $$('[data-vars]').forEach(el => {
    if (el.dataset.vars.split(',').includes(varName)) {
      el.classList.add('editing-highlight')
    }
  })
  const swatch = $q(`[data-var="${varName}"]`)
  if (swatch) swatch.classList.add('editing-highlight')
}

function clearHighlights() {
  $$('.editing-highlight').forEach(el => el.classList.remove('editing-highlight'))
}

function updatePanelForVar(varName) {
  $('currentVarName').textContent = varName
  const value = getVarValue(varName)
  const hexValue = colorToHex(value)

  $('colorPreview').style.background = value
  $('colorPicker').value = hexValue.slice(0, 7)
  $('hexInput').value = value

  const hsl = hexToHsl(hexValue)
  $('hueSlider').value = hsl.h
  $('satSlider').value = hsl.s
  $('lightSlider').value = hsl.l
  $('alphaSlider').value = hsl.a
  updateSliderLabels(hsl)

  const cascadeNote = $('cascadeNote')
  if (CASCADE_MAP[varName]) {
    const childVars = Object.keys(CASCADE_MAP[varName])
    cascadeNote.style.display = 'block'
    $('cascadeVars').textContent = childVars.map(v => v.replace('--color-', '')).join(', ')
  } else {
    cascadeNote.style.display = 'none'
  }
}

function updateSliderLabels(hsl) {
  $('hueValue').textContent = `${Math.round(hsl.h)}°`
  $('satValue').textContent = `${Math.round(hsl.s)}%`
  $('lightValue').textContent = `${Math.round(hsl.l)}%`
  $('alphaValue').textContent = `${Math.round(hsl.a)}%`
}

// ===== Event Handlers =====
function handleColorPick(value) {
  if (!currentVar) return
  setVar(currentVar, value)
  updatePanelForVar(currentVar)
}

function handleHexInput(value) {
  if (!currentVar) return
  if (/^#?[0-9a-fA-F]{6,8}$/.test(value)) {
    const hex = value.startsWith('#') ? value : '#' + value
    setVar(currentVar, hex)
    updatePanelForVar(currentVar)
  }
}

function handleSliderChange() {
  if (!currentVar) return
  const h = parseFloat($('hueSlider').value)
  const s = parseFloat($('satSlider').value)
  const l = parseFloat($('lightSlider').value)
  const a = parseFloat($('alphaSlider').value)

  updateSliderLabels({ h, s, l, a })

  const color = a < 100 ? `hsla(${h}, ${s}%, ${l}%, ${a / 100})` : hslToHex(h, s, l)

  setVar(currentVar, color)
  $('colorPreview').style.background = color
  $('hexInput').value = color
  $('colorPicker').value = hslToHex(h, s, l).slice(0, 7)
}

// ===== Actions =====
function copyCurrentVar() {
  if (!currentVar) return
  const value = getVarValue(currentVar)
  navigator.clipboard.writeText(`${currentVar}: ${value};`)
  showToast('Copied to clipboard!')
}

function resetCurrentVar() {
  if (!currentVar || !originalValues[currentVar]) return

  document.documentElement.style.removeProperty(currentVar)
  delete modifications[currentVar]

  let resetCount = 1
  if (CASCADE_MAP[currentVar]) {
    Object.keys(CASCADE_MAP[currentVar]).forEach(childVar => {
      if (modifications[childVar]) {
        document.documentElement.style.removeProperty(childVar)
        delete modifications[childVar]
        updateSwatchValue(childVar, getVarValue(childVar))
        resetCount++
      }
    })

    if (TEXT_CONTRAST_MAP[currentVar]) {
      document.documentElement.style.removeProperty(TEXT_CONTRAST_MAP[currentVar])
    }
  }

  updateModCount()
  updatePanelForVar(currentVar)
  updateSwatchValue(currentVar, getVarValue(currentVar))
  showToast(resetCount > 1 ? `Reset ${resetCount} variables to original` : 'Reset to original')
}

function resetAll() {
  if (!confirm('Reset all modifications?')) return
  Object.keys(modifications).forEach(varName => {
    document.documentElement.style.removeProperty(varName)
  })
  modifications = {}
  updateModCount()
  renderSwatches()
  renderGradientSection()
  if (currentVar) updatePanelForVar(currentVar)
  showToast('All changes reset')
}

function exportCSS() {
  const count = Object.keys(modifications).length
  if (count === 0) {
    showToast('No modifications to export')
    return
  }

  let css = `/* Theme modifications based on ${currentTheme} */\n`
  css += `[data-theme='${currentTheme}-custom'] {\n`

  // Export color vars
  Object.values(COLOR_VARS)
    .flat()
    .forEach(varName => {
      const value = getVarValue(varName)
      const isModified = modifications[varName]
      css += `  ${varName}: ${value};${isModified ? ' /* modified */' : ''}\n`
    })

  // Export gradient stop vars if this theme has an advanced gradient
  const exportConfig = GRADIENT_VARS[currentTheme]
  if (exportConfig) {
    css += `\n  /* Advanced gradient stops */\n`
    exportConfig.stops.forEach(stop => {
      Object.values(stop.vars).forEach(varName => {
        const value = getVarValue(varName)
        const isModified = modifications[varName]
        css += `  ${varName}: ${value};${isModified ? ' /* modified */' : ''}\n`
      })
    })
  }

  css += `}\n`

  navigator.clipboard.writeText(css)
  showToast(`Copied ${count} modifications as CSS!`)
}

function generateThemeCSS(themeName) {
  let css = `/* Theme: ${themeName} */\n`
  css += `/* Based on: ${currentTheme} */\n`
  css += `/* Created: ${new Date().toISOString().split('T')[0]} */\n\n`
  css += `[data-theme='${themeName}'] {\n`

  // Color vars
  Object.values(COLOR_VARS)
    .flat()
    .forEach(varName => {
      css += `  ${varName}: ${getVarValue(varName)};\n`
    })

  // Gradient stop vars
  const themeConfig = GRADIENT_VARS[currentTheme]
  if (themeConfig) {
    css += `\n  /* Advanced gradient stops */\n`
    themeConfig.stops.forEach(stop => {
      Object.values(stop.vars).forEach(varName => {
        css += `  ${varName}: ${getVarValue(varName)};\n`
      })
    })
  }

  css += `}\n`
  return css
}

// ===== Utility =====
function showToast(message) {
  const toast = $('toast')
  toast.textContent = message
  toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 2000)
}

function setupClickHandlers() {
  $$('[data-vars]').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', e => {
      e.preventDefault()
      openPanel(el.dataset.vars.split(',')[0])
    })
  })
}

function saveOriginalValues() {
  Object.values(COLOR_VARS)
    .flat()
    .forEach(varName => {
      originalValues[varName] = getVarValue(varName)
    })

  // Save gradient stop vars too
  const stopConfig = GRADIENT_VARS[currentTheme]
  if (stopConfig) {
    stopConfig.stops.forEach(stop => {
      Object.values(stop.vars).forEach(varName => {
        originalValues[varName] = getVarValue(varName)
      })
    })
  }
}

// ===== Local Save Server =====
let localServerAvailable = false

async function checkLocalServer() {
  try {
    const response = await fetch(`${LOCAL_SERVER_URL}/health`, { method: 'GET', mode: 'cors' })
    localServerAvailable = response.ok
  } catch {
    localServerAvailable = false
  }
  updateServerStatus()
}

function updateServerStatus() {
  const indicator = $('serverStatus')
  if (indicator) {
    indicator.style.display = 'block'
    indicator.innerHTML = localServerAvailable
      ? '<span style="color: var(--color-success);">● Local server connected</span>'
      : '<span style="color: var(--color-text-muted);">○ Local server offline — <code>pnpm --filter @wolffm/themes dev</code></span>'
  }
  const applyBtn = $('applyBtn')
  if (applyBtn) {
    applyBtn.disabled = !localServerAvailable
    applyBtn.title = localServerAvailable
      ? ''
      : 'Start local server: pnpm --filter @wolffm/themes dev'
  }
}

async function applyChanges() {
  const count = Object.keys(modifications).length
  if (count === 0) {
    showToast('No modifications to apply')
    return
  }
  if (!localServerAvailable) {
    showToast('Local server not running — run: pnpm --filter @wolffm/themes dev')
    return
  }

  try {
    const response = await fetch(`${LOCAL_SERVER_URL}/save-theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        themeName: currentTheme,
        css: generateThemeCSS(currentTheme),
        mode: 'update'
      })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to save')
    showToast(`Applied ${count} changes to themes/src/style.css`)
  } catch (error) {
    showToast(`Error: ${error.message}`)
  }
}

// ===== Event Listeners =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (pickerOpen) {
      pickerOpen = false
      renderThemePicker()
    }
  }
})

// ===== Start =====
init()
checkLocalServer()
setInterval(checkLocalServer, 5000)

// Expose functions for inline onclick handlers
window.editor = {
  openPanel,
  closePanel,
  setTheme,
  setMode,
  togglePicker,
  handleColorPick,
  handleHexInput,
  handleSliderChange,
  handleGradientSlider,
  copyCurrentVar,
  resetCurrentVar,
  resetAll,
  exportCSS,
  applyChanges
}
