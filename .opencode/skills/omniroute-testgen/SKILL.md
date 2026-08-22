---
name: omniroute-testgen
description: Gera testes automaticamente via Omniroute IA. Use quando precisar criar testes para código existente ou novos componentes. POST /api/v1/ai/generate-tests.
---

# Omniroute TestGen

Gera testes unitários/de integração usando IA via Omniroute.

## Como usar

O `@dev-frontend` pode delegar a geração de testes via task tool, chamando a API:

```bash
curl -X POST http://localhost:8080/api/v1/ai/generate-tests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sourceCode": "public class OrderService { ... }",
    "framework": "JUnit 5"
  }'
```

## Frameworks suportados
- Frontend: `Vitest`, `Testing Library React`, `Cypress`
- Backend: `JUnit 5`, `MockMvc`, `Testcontainers`

## Prompt padrão
O backend usa este system prompt:
```
Você é um engenheiro de QA especializado em testes automatizados.
Gere testes concisos e completos.
```
