---
description: Prepara e executa commit com revisão prévia (detect_changes + code-reviewer).
---

# Commit Tecladista IA

1. Execute `gitnexus_detect_changes()` e reporte resultado
2. Delegue para `@code-reviewer` revisar o diff
3. Se aprovado, pergunte ao usuário: "commitar? (s/N)"
4. Se sim: `git add` SOMENTE dos arquivos revisados (nunca `git add .`) + `git commit`
5. Mensagem: Conventional Commits, subject ≤50 chars, body só quando o "porquê" não for óbvio
6. Após o commit, `git push origin main` é permitido ao reviewer
