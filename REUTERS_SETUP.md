# Reuters para Luzifer

Conector oficial de titulares Reuters a través de LSEG Data Platform. Se añade al servicio de noticias existente. La lógica del calendario, los scores, las fórmulas, los BUY/SELL, los webhooks anteriores y los ejecutores de oro/euro se conservan.

El conector no crea, bloquea ni retrasa operaciones. No asigna dirección de compra o venta a partir de palabras aisladas de un titular.

## Acceso necesario

Se necesita una suscripción de LSEG con acceso a Reuters News para uso programático en servidor. Ver noticias en TradingView, tener GitHub/Render o tener una cuenta de LSEG Workspace de escritorio no sustituye ese acceso.

Las credenciales se guardan únicamente en las variables de entorno del servicio `luzifer-news-engine` en Render. No deben enviarse en chats, en Pine, en alertas ni en commits.

| Variable | Valor o propósito |
| --- | --- |
| `REUTERS_ENABLED` | `true` para activar el conector una vez configuradas las credenciales |
| `REUTERS_READER_TOKEN` | Secreto independiente para leer titulares mediante HTTPS |
| `REUTERS_POLL_SECONDS` | `60` por defecto; consulta periódica, no streaming |
| `REUTERS_STALE_SECONDS` | `180` por defecto; una conexión más antigua se marca como desactualizada |
| `REUTERS_WINDOW_MIN` | `90` por defecto; ventana de publicaciones |
| `LSEG_NEWS_QUERY` | `Language:LEN` por defecto; siempre se añade el filtro `Source:RTRS` |

Configurar **uno** de los siguientes tipos de acceso, según las credenciales emitidas por LSEG:

| Autenticación | Variables requeridas |
| --- | --- |
| V1: cuenta de plataforma/máquina | `LSEG_AUTH_VERSION=v1`, `LSEG_USERNAME`, `LSEG_PASSWORD`, `LSEG_APP_KEY` |
| V2: cuenta de servicio | `LSEG_AUTH_VERSION=v2`, `LSEG_CLIENT_ID`, `LSEG_CLIENT_SECRET` |

El acceso de servidor a noticias debe estar habilitado para esa cuenta. Una respuesta HTTP 403 significa que no se pudo autorizar la consulta; no se representa como una conexión funcional.

## Verificación

`GET /health` incluye el estado de Reuters sin mostrar credenciales ni titulares. `GET /news/reuters/status` muestra el mismo diagnóstico.

`GET /news/reuters`, con el encabezado `Authorization: Bearer <REUTERS_READER_TOKEN>`, devuelve los titulares de la cuenta autorizada. Sin ese encabezado devuelve HTTP 401. El contenido no se expone en los endpoints públicos ni en los webhooks existentes.

Se considera conectado solo después de autenticar y recibir una respuesta válida del servicio de noticias. `not_configured` identifica credenciales pendientes; `unavailable` identifica errores; `stale` identifica una actualización demasiado antigua. La recepción de titulares reales requiere además comprobar `headlineCount` y sus fechas.

Las publicaciones se deduplican por identificador y versión; las retiradas se eliminan. Las consultas se limitan a tres páginas de cien titulares y reportan `coverageIncomplete` si quedan páginas pendientes. No se infiere latencia garantizada ni exhaustividad.

Pruebas locales: `npm test`.

## Documentación oficial

- [Reuters News en LSEG Data Platform](https://developers.lseg.com/en/product/news/news_service_rdp)
- [Credenciales de plataforma V1/V2](https://developers.lseg.com/en/api-catalog/lseg-data-platform/lseg-data-library-for-python/quick-start/access-credentials)
- [Parámetros y paginación de titulares](https://developers.lseg.com/en/article-catalog/article/lseg-data-library-for-python--news-pagination)

Base conservada: `3a1974836c77475cfddb97bda44a2b86fff291f7`.
