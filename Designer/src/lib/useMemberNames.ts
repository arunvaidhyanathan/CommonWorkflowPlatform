// Maps tenant member ids (task assignees, instance starters) to usernames.
import { useCallback, useEffect, useState } from 'react'
import { listTenantMembers } from '../data/admin'

export function useMemberNames(tenantId: string | null): (id: string | null) => string {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!tenantId) return
    listTenantMembers(tenantId)
      .then((members) => setNames(Object.fromEntries(members.map((m) => [m.id, m.email || m.displayName || m.id]))))
      .catch(() => setNames({}))
  }, [tenantId])
  return useCallback((id: string | null) => (id ? (names[id] ?? id.slice(0, 8)) : '--'), [names])
}
