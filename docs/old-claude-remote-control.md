# OLD: Claude без ноутбука (Remote Control на сервере)

Сервер: OLD, 187.77.122.166 (srv1764947). Пользователь: `old-claude`. Харнесс: `/opt/old-harness`.

## Схема

```
Телефон (приложение Claude, раздел Code)
        │  HTTPS (исходящее соединение с сервера, входящие порты не нужны)
        ▼
OLD: systemd → old-claude → claude remote-control  (рабочий каталог, свой HOME)
```

Ноутбук и облачная сессия не участвуют. Сервер сам держит соединение с Claude, а вы видите его сессию в приложении.

## Статус пунктов

| Пункт | Статус |
|---|---|
| Claude установлен, пользователь old-claude, служба с ready guard | По вашим словам, готово. Мной не проверено |
| `/login` под old-claude | Не сделан. Нужен один раз, вашими руками |
| Remote Control под systemd | Не настроен. Шаги ниже |
| Работа после закрытия SSH, доступ к каталогам | Проверить после шага 4 |

## Шаг 0. Терминал без ноутбука

Подойдёт любой из вариантов:
- браузерный терминал VPS в панели Hostinger, открытый с телефона (проверьте, что он есть в вашем тарифе);
- SSH-клиент на телефоне (Termius, Blink, JuiceSSH) с отдельным ключом, созданным на телефоне.

## Шаг 1. Проверка текущей конфигурации (только чтение)

```bash
ls -la /opt/old-harness
ls /opt/old-harness/*.md /opt/old-harness/docs 2>/dev/null
systemctl list-units --all | grep -iE 'claude|old'
systemctl cat <claude-service>          # ExecStart, ready guard (ExecStartPre / ConditionPathExists)
id old-claude                            # не должно быть sudo, wheel, docker
sudo -l -U old-claude                    # ожидается: not allowed
getent passwd old-claude | cut -d: -f6   # HOME
```

Если `ExecStart` у существующей службы уже запускает `claude remote-control`, новую службу из шага 3 не создавайте. Сделайте `/login` (шаг 2) и запустите существующую службу так, как описано в документации харнесса.

## Шаг 2. Официальный вход (один раз)

```bash
tmux new -s claude-login
sudo -iu old-claude
cd <WORKDIR>              # разрешённый рабочий каталог, не HOME
claude                    # в интерфейсе: /login, откройте ссылку на телефоне, вставьте код
```

Проверка без вывода секретов:

```bash
ls -l ~/.claude/.credentials.json        # -rw------- old-claude
claude -p "ответь одним словом: ok"
exit
```

Remote Control работает только через вход в аккаунт claude.ai. API-ключ и токен из `claude setup-token` для Remote Control не подходят: по документации такой токен годится только для запросов к модели.

Там же, в терминале, один раз запустите Remote Control вручную и ответьте на оба вопроса:

```bash
cd <WORKDIR>
claude remote-control     # подтвердите доверие к каталогу (workspace trust) и ответьте y на "Enable Remote Control? (y/n)"
# убедитесь, что сессия появилась в приложении на телефоне, затем Ctrl+C
```

Без этого шага служба упадёт с ошибкой `Workspace not trusted`: без терминала команда не может задать вопрос.

## Шаг 3. Служба Remote Control (только если её ещё нет)

`/etc/systemd/system/old-claude-rc.service`:

```ini
[Unit]
Description=Claude Code Remote Control (old-claude)
After=network-online.target
Wants=network-online.target
# Ready guard: тот же механизм, что у существующей службы, без обхода
ConditionPathExists=<READY_FLAG_FROM_HARNESS_DOCS>

[Service]
User=old-claude
Group=old-claude
WorkingDirectory=<WORKDIR>
Environment=HOME=<OLD_CLAUDE_HOME>
ExecStart=<PATH_TO_CLAUDE> remote-control
Restart=on-failure
RestartSec=15

# Без расширения прав
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=<WORKDIR> <OLD_CLAUDE_HOME>
SupplementaryGroups=

[Install]
WantedBy=multi-user.target
```

```bash
sudo -u old-claude which claude          # подставьте в <PATH_TO_CLAUDE>
systemctl daemon-reload
systemctl enable --now old-claude-rc
systemctl status old-claude-rc --no-pager
journalctl -u old-claude-rc -n 50 --no-pager
```

По документации без терминала `claude remote-control` завершается с `Workspace not trusted`, если доверие не подтверждено заранее (шаг 2). Для SSH-машин документация рекомендует tmux. Если прямой запуск не держится, используйте вариант через tmux:

```ini
Type=forking
ExecStart=/usr/bin/tmux new-session -d -s rc -c <WORKDIR> '<PATH_TO_CLAUDE> remote-control'
ExecStop=/usr/bin/tmux kill-session -t rc
```

## Шаг 4. Проверки

```bash
# закройте SSH полностью и подключитесь заново
systemctl is-active old-claude-rc
sudo -u old-claude test -w <WORKDIR> && echo WRITE_OK
sudo -u old-claude test -w <CODEX_DIR> && echo "ПЛОХО: есть доступ" || echo "OK: нет доступа"
sudo -u old-claude docker ps 2>&1 | head -1     # ожидается permission denied
```

На телефоне: приложение Claude, раздел Code. Там должна появиться сессия с сервера. Дайте ей тестовую задачу, например «прочитай CLAUDE.md и перечисли активные locks», и ничего не меняйте.

## Как давать задачи с телефона

1. Откройте приложение Claude, раздел Code, сессию OLD.
2. Первой строкой укажите область работы: каталог и запрет на чужие locks.
3. Перед началом Claude сверяется с проектными инструкциями и locks Codex. Это должно быть прописано в `CLAUDE.md` рабочего каталога.

## Риски

- Если старое сообщение из Telegram или другой канал попадут в Remote Control-сессию, они получат права old-claude. Поэтому права остаются минимальными: без sudo и без docker.
- Срок действия входа может закончиться. Признак: в журнале ошибка авторизации. Решение: повторить шаг 2.
- Не трогайте Codex, Telegram, production и HoS Kit: в `ReadWritePaths` только `<WORKDIR>` и HOME old-claude.

## Что известно из проектной документации (NRE, Google Drive)

Прочитано 2026-11-01: `stankalachev-lab/NRE` (dev/DESIGN_AUTH_OWN.md, dev/WORKING_IN_PARALLEL.md, dev/TWO_SERVER_DEPLOY.md, ops/two-server/README.md, dev/tasks/T-sales-production-prep-20261029.md), а также Google Drive: «Правила совместной работы Codex и Claude» и база знаний headofsales.me.

**Роль OLD.** Control plane: worktrees, проверки, сборка, координатор, Telegram publisher, NRE stage. Production работает на NEW, 72.61.209.181.

**Как туда заходят сейчас** (замер от 28.08.2026, DESIGN_AUTH_OWN.md §6.4):
- root по SSH. Пароль владелец передаёт на каждый вызов через Node-пакет `ssh2` (`vps_run.js`), он нигде не хранится;
- один ключ в `/root/.ssh/authorized_keys`, ed25519, комментарий `stanislav`. Это рабочая станция владельца;
- `sshd -T`: `permitrootlogin yes`, `passwordauthentication yes`.

Итог: «существующий профиль подключения» привязан к ноутбуку (ключ) или к паролю, который вводится каждый раз. В облачную сессию без передачи секрета его не перенести, а правила проекта это запрещают.

**Порт 48222** в документации относится к NEW (`root@72.61.209.181:48222`, только ключ издателя с forced command). Для OLD нестандартный порт в репозитории не указан. Через облачный прокси на 187.77.122.166:48222 SSH-баннер не пришёл.

**Харнесс Claude** (`/opt/old-harness`, `old-claude`, ready guard) в репозитории NRE не описан. Его документация, видимо, лежит только на сервере, например в `/var/lib/nre-codex/projects/headofsales/technical-kb/README.md`. Шаг 1 обязателен.

**Правила совместной работы с Codex (их должен соблюдать Claude на OLD):**
- координация: `coordination/CURRENT_COORDINATOR.json`, `coordination/README.md`, канал `tools/nre-mail` (адрес `coordinator`), ACK прочитанных сообщений;
- черновики Codex лежат в `/var/lib/nre-codex/projects/*`, разработка идёт в `/opt/nre-work/T-*` (ветки `task/T-*`);
- live `/opt/nre` не редактировать, checkout, stash и reset там запрещены. Docker и Git для обхода ограничений не использовать;
- один файл одновременно правит один исполнитель. Передача через `docs/collaboration-handoff.md` по шаблону из правил;
- релизы выпускает только `nre-ship` на NEW (решение от 25.10.2026). Claude на OLD релизы не выпускает.

Для `<WORKDIR>` нужен отдельный каталог Claude, например `/var/lib/old-claude/projects/<проект>`. Каталоги Codex и `/opt/nre` в `ReadWritePaths` не включать.

**Риск, найденный по ходу (вне этой задачи):** вход root по паролю включён. Отключать его не нужно, пока это единственный запасной вход (см. §6.4 «no break-glass»). Решение остаётся за владельцем.

## Источники

- https://code.claude.com/docs/en/remote-control : только исходящий HTTPS на 443, вход через claude.ai, workspace trust, tmux для удалённых машин.
- https://code.claude.com/docs/en/cloud-environments : облачные сессии ходят через HTTP/HTTPS-прокси. SSH и нестандартные порты там не описаны.

## Альтернатива (не рекомендуется)

Облачная сессия Claude Code с доступом к серверу по SSH. Для неё нужен исходящий порт 22 в сетевой политике окружения и приватный ключ в секретах окружения. Минусы:
- ключ к серверу хранится в облаке;
- в документации облачных окружений описан только HTTP/HTTPS-прокси, а SSH, IP-адреса и порты в списке разрешённых доменов не упоминаются;
- сетевые секреты передаются HTTP-заголовками и для SSH-ключей не предназначены;
- переменные окружения видит любой, кто пользуется окружением.

Проверено 2026-11-01: локальный прокси принимает CONNECT на 187.77.122.166 (порты 22, 2222, 2022, 8022, 10022, 22022, 65002), но SSH-баннер не приходит ни на одном из них.
