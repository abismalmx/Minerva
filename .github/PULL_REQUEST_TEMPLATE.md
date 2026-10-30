## Resumen

<!-- Que cambia este PR y por que. -->

## Tipo de cambio

- [ ] Correccion de bug (`fix`)
- [ ] Nueva funcionalidad (`feat`)
- [ ] Documentacion (`docs`)
- [ ] Refactorizacion (`refactor`)
- [ ] Build / CI (`build`)

## Como se verifica

<!-- Pasos exactos para reproducir la validacion. -->

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
```

<!-- En el backend Rust: -->
<!--
pnpm --filter @minerva/app fmt:check
pnpm --filter @minerva/app clippy:check
-->

## Checklist

- [ ] El codigo compila y los tests pasan localmente.
- [ ] No he anadido credenciales, claves ni datos personales.
    Las variables de entorno van en `.env` (ignorado por git); el repositorio
    solo publica `.env.example`.
- [ ] He actualizado la documentacion afectada.
- [ ] Los commits siguen el formato convencional.
- [ ] Si el cambio toca `apps/minerva-app/src-tauri/**`, he actualizado el
    `Cargo.lock` correspondiente.
