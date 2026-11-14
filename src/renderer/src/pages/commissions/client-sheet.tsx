import { useState } from 'react'
import type { Client } from '@shared/domain'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { archiveClient, createClient, unarchiveClient, updateClient } from '@/data/client-actions'
import { formatIpcError } from '@/lib/ipc-error'

interface ClientSheetProps {
  mode: 'create' | 'edit'
  client: Client | null
  onClose: () => void
  onSaved: () => void
}

type PendingConfirm = 'close' | 'archive' | 'unarchive' | null

/**
 * 客户新建 / 编辑面板。
 *
 * - 关闭前若有未保存修改，先弹出“放弃修改”确认（Esc、遮罩、关闭按钮都走同一路径）；
 * - 归档 / 取消归档都需确认；
 * - 所有写操作走真实 IPC，错误信息来自主进程。
 */
export function ClientSheet({ mode, client, onClose, onSaved }: ClientSheetProps) {
  const initial = {
    name: client?.name ?? '',
    contact: client?.contact ?? '',
    note: client?.note ?? ''
  }

  const [name, setName] = useState(initial.name)
  const [contact, setContact] = useState(initial.contact)
  const [note, setNote] = useState(initial.note)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const dirty = name !== initial.name || contact !== initial.contact || note !== initial.note
  const archived = client?.archivedAt !== null && client?.archivedAt !== undefined

  function requestClose() {
    if (!dirty) {
      onClose()
      return
    }
    setConfirm('close')
  }

  async function submit() {
    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      setError('客户名称不能为空')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: trimmedName,
        contact: contact.trim().length > 0 ? contact.trim() : null,
        note: note.trim().length > 0 ? note.trim() : null
      }

      if (mode === 'create') {
        await createClient(payload)
      } else if (client) {
        await updateClient({ id: client.id, ...payload })
      }

      onSaved()
      onClose()
    } catch (submitError) {
      setError(formatIpcError(submitError))
    } finally {
      setSaving(false)
    }
  }

  async function runArchiveToggle() {
    if (!client) return
    setConfirmBusy(true)
    setError(null)
    try {
      if (archived) {
        await unarchiveClient(client.id)
      } else {
        await archiveClient(client.id)
      }
      setConfirm(null)
      onSaved()
      onClose()
    } catch (archiveError) {
      setConfirm(null)
      setError(formatIpcError(archiveError))
    } finally {
      setConfirmBusy(false)
    }
  }

  return (
    <>
      <Sheet
        title={mode === 'create' ? '新建客户' : '客户资料'}
        description={mode === 'create' ? '填好名称即可创建' : client?.name}
        onRequestClose={requestClose}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              {mode === 'edit' && client ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirm(archived ? 'unarchive' : 'archive')}
                  disabled={saving}
                >
                  {archived ? '取消归档' : '归档客户'}
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={requestClose} disabled={saving}>
                取消
              </Button>
              <Button type="button" size="sm" onClick={() => void submit()} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        }
      >
        <form
          id="client-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-name">客户名称 *</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：小夏"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-contact">联系方式</Label>
            <Input
              id="client-contact"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="QQ / 微信 / 邮箱（可选）"
              maxLength={500}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-note">备注</Label>
            <Textarea
              id="client-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="沟通偏好、结算方式等（可选）"
              maxLength={4000}
            />
          </div>

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </Sheet>

      <ConfirmDialog
        open={confirm === 'close'}
        title="放弃未保存的修改？"
        description="这个客户的修改还没有保存，关闭后将会丢失。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        destructive
        onConfirm={() => {
          setConfirm(null)
          onClose()
        }}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'archive'}
        title="归档这个客户？"
        description="归档不会删除任何历史记录，但该客户将不再出现在新建委托的客户列表中。之后可以随时取消归档。"
        confirmLabel="归档"
        busy={confirmBusy}
        onConfirm={() => {
          void runArchiveToggle()
        }}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'unarchive'}
        title="取消归档这个客户？"
        description="取消归档后，该客户会重新出现在新建委托的客户列表中。"
        confirmLabel="取消归档"
        busy={confirmBusy}
        onConfirm={() => {
          void runArchiveToggle()
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
