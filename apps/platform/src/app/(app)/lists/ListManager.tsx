'use client'
import { useState, useTransition } from 'react'
import { createItem, deleteItem, updateItem, type Kind, type Result } from './actions'

type Item = { id: string; name: string; university: string | null; active: boolean; inUse: number }
const campusLabel = (u: string | null) => (u ? u.charAt(0).toUpperCase() + u.slice(1) : 'All campuses')

export function ListManager({ kind, noun, items, campuses, usedLabel }: { kind: Kind; noun: string; items: Item[]; campuses: string[]; usedLabel: string }) {
  const [name, setName] = useState('')
  const [campus, setCampus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    start(async () => { const r = await createItem(kind, name, campus); if (r.error) return setError(r.error); setName('') })
  }
  return (
    <>
      {/* Controlled fields: React 19 clears uncontrolled ones after an action, which would wipe the name on a validation error. */}
      <form onSubmit={submit} className="card flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm font-semibold">New {noun}
          <input className="input mt-2 font-normal" value={name} onChange={(e) => { setName(e.target.value); setError(null) }} maxLength={60} required />
        </label>
        <label className="text-sm font-semibold">Offered to
          <select className="input mt-2 w-48 font-normal" value={campus} onChange={(e) => { setCampus(e.target.value); setError(null) }}>
            <option value="">All campuses</option>
            {campuses.map((c) => <option key={c} value={c}>{campusLabel(c)} only</option>)}
          </select>
        </label>
        <button className="btn" disabled={pending || !name.trim()}>{pending ? 'Adding…' : `Add ${noun}`}</button>
        {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead><tr className="label"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Offered to</th><th className="p-3 font-medium">{usedLabel}</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{items.map((i) => <Row key={i.id} kind={kind} noun={noun} item={i} />)}
            {items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink-2">Nothing here yet. Add the first {noun} above.</td></tr>}</tbody>
        </table>
      </div>
      <p className="text-xs text-ink-2">Renaming updates every student who has the old name. Archived entries are no longer offered to students, and anyone who already has one keeps it. An entry can only be deleted when nobody has it.</p>
    </>
  )
}

function Row({ kind, noun, item }: { kind: Kind; noun: string; item: Item }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<Result>, after?: () => void) => { setError(null); start(async () => { const r = await fn(); if (r.error) setError(r.error); else after?.() }) }

  return (
    <tr className="border-t border-line align-top">
      <td className="p-3">
        {editing ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => updateItem(kind, item.id, { name }), () => setEditing(false)) }}>
            <input aria-label={`New name for ${item.name}`} className="input h-9 w-56" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus required />
            <button className="btn h-9 px-3" disabled={pending || !name.trim()}>Save</button>
            <button type="button" className="btn btn-ghost h-9 px-3" onClick={() => { setEditing(false); setName(item.name); setError(null) }}>Cancel</button>
          </form>
        ) : <span className={item.active ? 'font-medium' : 'text-ink-3 line-through'}>{item.name}</span>}
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      </td>
      <td className="p-3">{campusLabel(item.university)}</td>
      <td className="p-3 tabular-nums">{item.inUse}</td>
      <td className="p-3">{item.active ? <span className="badge">Active</span> : <span className="badge text-warn">Archived</span>}</td>
      <td className="p-3">
        <div className="flex flex-wrap justify-end gap-2">
          {!editing && <button className="btn btn-ghost h-9 px-3" onClick={() => { setEditing(true); setError(null) }}>Rename</button>}
          <button className="btn btn-ghost h-9 px-3" disabled={pending} onClick={() => run(() => updateItem(kind, item.id, { active: !item.active }))}>{item.active ? 'Archive' : 'Restore'}</button>
          {confirmDelete ? (
            <>
              <button className="btn btn-danger h-9 px-3" disabled={pending} onClick={() => run(() => deleteItem(kind, item.id), () => setConfirmDelete(false))}>Delete {noun}</button>
              <button className="btn btn-ghost h-9 px-3" onClick={() => setConfirmDelete(false)}>Keep</button>
            </>
          ) : (
            <button className="btn btn-ghost h-9 px-3 text-danger" disabled={item.inUse > 0 || pending} title={item.inUse > 0 ? 'Students still have this. Archive it instead.' : undefined} onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
        </div>
      </td>
    </tr>
  )
}
