/**
 * The live sample: the app's REAL components — TaskLayout, TaskItem, the board
 * and tag pills, StatusChip, Modal, Toast — rendered under the theme being
 * edited, with every colour token set inline from the draft.
 *
 * Setting ALL of the theme's tokens (not just the edited ones) matters: the
 * page's stylesheet is whatever version hadoku.me last deployed, and main may
 * be ahead of it. Inline values are main + draft, so the preview shows what a
 * save would ship rather than what happens to be loaded.
 */
import React, { useMemo, useState } from 'react'
import { FAMILIES, isDarkTheme, type ThemeTokens } from '@wolffm/themes/contract'
import { Modal, Toast } from '@wolffm/task-ui-components'
import type { Board, Task, TaskStatusKind } from '../domain/types'
import { useTaskSort } from '../hooks/useTaskSort'
import { TaskLayout } from '../components/TaskLayout'
import { BoardButton } from '../components/BoardButton'
import { TagFilterButton } from '../components/TagFilterButton'
import { StatusChip } from '../components/StatusChip'

const noop = () => {}
const noopAsync = async () => {}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const TASKS: Task[] = [
  { id: 't1', title: 'Review PR 42', tag: 'code', state: 'Active', createdAt: ago(40) },
  {
    id: 't2',
    title: 'Fix login bug',
    tag: 'urgent',
    state: 'Active',
    createdAt: ago(5),
    notes: 'Repro: sign out, sign in on a second tab.'
  },
  { id: 't3', title: 'Write release notes', tag: 'docs', state: 'Active', createdAt: ago(300) },
  { id: 't4', title: 'Plan sprint', tag: null, state: 'Active', createdAt: ago(1500) },
  {
    id: 't5',
    title: 'Ship the theme editor',
    tag: 'code',
    state: 'Completed',
    createdAt: ago(600),
    closedAt: ago(2)
  }
]

const BOARDS: Board[] = [
  { id: 'main', name: 'Main', tasks: TASKS, tags: ['code', 'urgent', 'docs'] },
  { id: 'work', name: 'Work', tasks: [], tags: [] }
]

const STATUSES: TaskStatusKind[] = ['working', 'waiting', 'blocked', 'done']

export function Preview({ theme, tokens }: { theme: string; tokens: ThemeTokens }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const style = useMemo(() => ({ ...tokens }) as React.CSSProperties, [tokens])
  const sort = useTaskSort()

  return (
    // Same nesting and attributes App.tsx renders, so the app's layout rules
    // (the centred 720px .task-app column, dark-theme hooks) apply unchanged.
    <div
      className="te-preview task-app-container hdk-advanced-page"
      data-theme={theme}
      data-dark-theme={isDarkTheme(theme) ? 'true' : 'false'}
      // The app always renders simple mode; without this advanced.css paints
      // the gradient page background the app never shows.
      data-theme-mode="simple"
      style={style}
    >
      <div className="task-app">
        <div className="task-app__boards">
          <div className="task-app__board-row">
            <div className="task-app__board-list">
              {BOARDS.map(b => (
                <BoardButton
                  key={b.id}
                  board={b}
                  isActive={b.id === 'main'}
                  isDragOver={false}
                  onSwitch={noop}
                  onContextMenu={noop}
                  onDragOverFilter={noop}
                  onMoveTasksToBoard={noopAsync}
                  onClearSelection={noop}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="task-app__controls">
          <input className="task-app__input" placeholder="Walk the dog..." readOnly />
        </div>

        <div className="task-app__filters">
          {['code', 'urgent', 'docs'].map(tag => (
            <TagFilterButton
              key={tag}
              tag={tag}
              isActive={tag === 'urgent'}
              isDragOver={false}
              onToggle={noop}
              onContextMenu={noop}
              onDragOver={noop}
              onDragLeave={noop}
              onDrop={noop}
            />
          ))}
        </div>

        <TaskLayout
          tasks={TASKS}
          topTags={['code', 'urgent', 'docs']}
          sortDirections={sort.sortDirections}
          dragOverTag={null}
          pendingOperations={new Set()}
          onComplete={noop}
          onDelete={noop}
          onEditTag={noop}
          onDragStart={noop}
          onDragOver={noop}
          onDragLeave={noop}
          onDrop={noop}
          toggleSort={sort.toggleSort}
          sortTasksByAge={sort.sortTasksByAge}
          getSortIcon={sort.getSortIcon}
          getSortTitle={sort.getSortTitle}
          deleteTag={noop}
        />

        <section className="te-samples" aria-label="Token samples">
          <div className="te-samples__row">
            {STATUSES.map(kind => (
              <StatusChip key={kind} status={{ kind, label: kind }} />
            ))}
          </div>

          <div className="te-samples__row">
            {FAMILIES.map(f => (
              <span
                key={f}
                className="te-sample-fill"
                style={{ background: `var(--color-${f})`, color: `var(--color-on-${f})` }}
              >
                {f}
              </span>
            ))}
          </div>
          <div className="te-samples__row">
            {FAMILIES.map(f => (
              <span
                key={f}
                className="te-sample-tint"
                style={{ background: `var(--color-${f}-bg)`, color: `var(--color-on-${f}-bg)` }}
              >
                {f}
              </span>
            ))}
          </div>

          <div className="te-samples__text">
            <span style={{ color: 'var(--color-text)' }}>Text</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>Secondary</span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>Tertiary</span>
            <span style={{ color: 'var(--color-text-muted)' }}>Muted</span>
          </div>

          <div className="te-samples__surfaces">
            <div style={{ background: 'var(--color-bg-alt)' }}>bg-alt</div>
            <div style={{ background: 'var(--color-bg-card)' }}>bg-card</div>
            <div style={{ background: 'var(--color-bg-hover)' }}>bg-hover</div>
          </div>

          <div className="te-samples__row">
            <button
              type="button"
              className="modal-button modal-button--primary"
              onClick={() => setDialogOpen(true)}
            >
              Open dialog
            </button>
          </div>

          <div className="te-samples__toasts">
            {(['success', 'error', 'info', 'warning'] as const).map(type => (
              <Toast
                key={type}
                type={type}
                message={`A ${type} toast`}
                duration={2_000_000_000}
                onClose={noop}
              />
            ))}
          </div>
        </section>

        <Modal
          isOpen={dialogOpen}
          title="Delete board?"
          onClose={() => setDialogOpen(false)}
          onConfirm={() => setDialogOpen(false)}
          confirmLabel="Delete"
          confirmDanger
        >
          <p>This removes the board and its 4 tasks.</p>
        </Modal>
      </div>
    </div>
  )
}
