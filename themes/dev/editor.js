import { colorToHex, hexToHsl, hslToHex, getContrastColor } from './color-utils.js'
import {
  COLOR_VARS,
  CASCADE_MAP,
  TEXT_CONTRAST_MAP,
  THEME_FAMILIES,
  THEME_ICONS,
  THEME_ICON_MAP,
  LOCAL_SERVER_URL,
  WORKER_URL
} from './config.js'

// ===== State =====
let currentTheme = 'light'
let currentVar = null
let modifications = {}
const originalValues = {}
let pickerOpen = false
let simpleMode = true

// ===== DOM Helpers =====
const $ = id => document.getElementById(id)
const $$ = sel => document.querySelectorAll(sel)
const $q = sel => document.querySelector(sel)

function getVarValue(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
}

// ===== Initialization =====
function init() {
  renderThemePicker()
  renderSwatches()
  renderCompactVars()
  setupClickHandlers()
  saveOriginalValues()
  updateThemePreview()
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

  $('themeNameBadge').textContent = currentTheme
  $('previewThemeName').textContent =
    currentTheme
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') + ' Theme'

  // Update surface mode
  const toggleLabel = $('surfaceToggleLabel')
  toggleLabel.textContent = simpleMode ? 'Simple' : 'Advanced'

  if (simpleMode) {
    // Simple: solid primary background, white text
    primaryCard.className = 'preview-card-large'
    primaryCard.style.background = 'var(--color-primary)'
    primaryCard.style.color = 'var(--color-on-primary)'
    document.documentElement.setAttribute('data-simple-mode', 'true')
    $('metallicNote').style.display = 'block'
  } else {
    // Advanced: metallic gradient with card-text colors
    primaryCard.className =
      'preview-card-large metallic-surface metallic-surface--noise metallic-surface--highlight card-gradient-offset'
    primaryCard.style.background = ''
    primaryCard.style.color = ''
    document.documentElement.removeAttribute('data-simple-mode')
    $('metallicNote').style.display = 'none'
  }
}

function toggleSurfaceMode() {
  simpleMode = !simpleMode
  updateThemePreview()
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
        <span class="var-label">${varName.replace('--color-', '')}</span>
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
  Object.values(COLOR_VARS)
    .flat()
    .forEach(varName => {
      const value = getVarValue(varName)
      const isModified = modifications[varName]
      css += `  ${varName}: ${value};${isModified ? ' /* modified */' : ''}\n`
    })
  css += `}\n`

  navigator.clipboard.writeText(css)
  showToast(`Copied ${count} modifications as CSS!`)
}

function generateThemeCSS(themeName) {
  let css = `/* Theme: ${themeName} */\n`
  css += `/* Based on: ${currentTheme} */\n`
  css += `/* Created: ${new Date().toISOString().split('T')[0]} */\n\n`
  css += `[data-theme='${themeName}'] {\n`
  Object.values(COLOR_VARS)
    .flat()
    .forEach(varName => {
      css += `  ${varName}: ${getVarValue(varName)};\n`
    })
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
  updateSaveToFileButton()
}

function updateSaveToFileButton() {
  const btn = $('saveToFileBtn')
  if (btn) btn.style.display = localServerAvailable ? 'block' : 'none'

  const indicator = $('serverStatus')
  if (indicator) {
    indicator.style.display = 'block'
    indicator.innerHTML = localServerAvailable
      ? '<span style="color: var(--color-success);">● Local server connected</span>'
      : '<span style="color: var(--color-text-muted);">○ Local server offline — <code>pnpm --filter @wolffm/themes dev</code></span>'
  }
}

async function saveToFile() {
  if (!localServerAvailable) {
    showToast('Local server not running')
    return
  }
  const count = Object.keys(modifications).length
  if (count === 0) {
    showToast('No modifications to save')
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
    showToast(`Saved ${count} changes to themes/src/style.css`)
  } catch (error) {
    showToast(`Error: ${error.message}`)
  }
}

// ===== Submit Theme =====
function openSubmitModal() {
  const count = Object.keys(modifications).length
  if (count === 0) {
    showToast('No modifications to submit')
    return
  }

  $('themeName').value = currentTheme + '-custom'
  $('authorName').value = ''
  $('themeDescription').value = ''
  $('submitStatus').style.display = 'none'
  $('submitBtn').disabled = false
  $('submitBtn').textContent = 'Submit Theme'
  $('submitModal').classList.add('show')
}

function closeSubmitModal() {
  $('submitModal').classList.remove('show')
}

async function submitTheme() {
  const themeName = $('themeName').value.trim()
  const authorName = $('authorName').value.trim()
  const description = $('themeDescription').value.trim()

  if (!themeName) {
    showSubmitStatus('error', 'Theme name is required')
    return
  }
  if (!/^[a-z0-9-]+$/.test(themeName)) {
    showSubmitStatus('error', 'Theme name must be lowercase letters, numbers, and hyphens only')
    return
  }

  const submitBtn = $('submitBtn')
  submitBtn.disabled = true
  submitBtn.textContent = 'Submitting...'
  showSubmitStatus('loading', 'Creating pull request...')

  try {
    const response = await fetch(`${WORKER_URL}/submit-theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        themeName,
        baseTheme: currentTheme,
        authorName: authorName || 'Anonymous',
        description: description || `Custom theme based on ${currentTheme}`,
        css: generateThemeCSS(themeName),
        modifications: Object.keys(modifications).length
      })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to create PR')

    showSubmitStatus(
      'success',
      `
      Pull request created!<br>
      <a href="${result.prUrl}" target="_blank" style="color: var(--color-success); text-decoration: underline;">
        View PR #${result.prNumber}
      </a>
    `
    )
    submitBtn.textContent = 'Submitted!'
  } catch (error) {
    showSubmitStatus('error', `Error: ${error.message}`)
    submitBtn.disabled = false
    submitBtn.textContent = 'Submit Theme'
  }
}

function showSubmitStatus(type, message) {
  const status = $('submitStatus')
  status.style.display = 'block'
  status.className = `submit-status ${type}`
  status.innerHTML = message
}

// ===== Event Listeners =====
$('submitModal').addEventListener('click', e => {
  if (e.target.id === 'submitModal') closeSubmitModal()
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('submitModal').classList.contains('show')) closeSubmitModal()
    else if (pickerOpen) {
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
  togglePicker,
  toggleSurfaceMode,
  handleColorPick,
  handleHexInput,
  handleSliderChange,
  copyCurrentVar,
  resetCurrentVar,
  resetAll,
  exportCSS,
  saveToFile,
  openSubmitModal,
  closeSubmitModal,
  submitTheme
}
