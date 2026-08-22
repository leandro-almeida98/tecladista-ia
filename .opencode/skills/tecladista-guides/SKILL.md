---
name: tecladista-guides
description: Guias de codificação do Tecladista IA — React/TS patterns, Zustand, API services, hooks customizados, validação com Zod. Consulte ao implementar novas features.
---

# Guias de Codificação — Tecladista IA

## React + TypeScript

### Componente funcional
```tsx
interface MinhaPaginaProps {
  id: string;
}

export default function MinhaPagina({ id }: MinhaPaginaProps) {
  return <div>{id}</div>;
}
```

### Store Zustand
```ts
import { create } from 'zustand';

interface SidebarStore {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}));
```

### API Service
```ts
import api from '../api';

export async function getMenu(id: string) {
  const { data } = await api.get(`/menu/${id}`);
  return data;
}
```

### Hook customizado
```ts
import { useAuthStore } from '../store/useAuthStore';

export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => Boolean(s.token));
}
```

## Validação

- Zod schemas antes de enviar request (parse no service ou no handler do formulário)

## Erros

- `try/catch` no service/hook com feedback na UI (toast)
- async/await sempre, sem `.then()`

## Nomenclatura

- Componentes: PascalCase; hooks/funções: camelCase
- Props: interface nomeada `NomeComponenteProps` (exportada)
- Stores: `useXxxStore`; hooks: `useXxx`
