const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const managementScript = fs.readFileSync(path.join(__dirname, '../scripts/manage.sh'), 'utf8')
const functions = managementScript.slice(0, managementScript.lastIndexOf('\n# 运行主函数'))

describe('crs update', () => {
  let directory

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crs-update-test-'))
    fs.mkdirSync(path.join(directory, 'web/admin-spa/dist'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), '{}')
    fs.writeFileSync(path.join(directory, 'web/admin-spa/package.json'), '{}')
    fs.writeFileSync(path.join(directory, 'web/admin-spa/dist/index.html'), 'existing UI')
    fs.writeFileSync(path.join(directory, 'web/admin-spa/dist/custom.txt'), 'custom file')
    fs.writeFileSync(path.join(directory, '.env'), 'NODE_ENV=production\n')
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function update(settings = {}) {
    const result = spawnSync('bash', ['-s'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        TMPDIR: directory,
        TEST_DIRECTORY: directory,
        TEST_EVENTS: path.join(directory, 'events.log'),
        TEST_ORIGIN: 'https://github.com/bensonz/claude-relay-service.git',
        ...settings
      },
      input: `${functions}
APP_DIR="$TEST_DIRECTORY"
INSTALL_DIR="$TEST_DIRECTORY"
git() {
    printf 'git %s\n' "$*" >> "$TEST_EVENTS"
    case "$*" in
        'diff --quiet') [ "$TEST_FAIL" != dirty ] ;;
        'diff --cached --quiet') [ "$TEST_FAIL" != staged ] ;;
        'fetch origin main') [ "$TEST_FAIL" != fetch ] ;;
        'merge-base --is-ancestor HEAD FETCH_HEAD') [ "$TEST_FAIL" != divergent ] ;;
        'merge --ff-only FETCH_HEAD') [ "$TEST_FAIL" != merge ] ;;
        'remote get-url origin') printf '%s\n' "$TEST_ORIGIN" ;;
        'ls-remote --heads origin web-dist') printf 'abc refs/heads/web-dist\n' ;;
        clone*)
            [ "$TEST_FAIL" != clone ] || return 1
            local target
            for target; do :; done
            printf 'downloaded UI' > "$target/index.html"
            ;;
        'log -1 --oneline') printf 'abc test update\n' ;;
        'status --short') printf ' M example.js\n' ;;
        *) printf 'Unexpected git command: %s\n' "$*" >&2; return 99 ;;
    esac
}
npm() {
    printf 'npm %s\n' "$*" >> "$TEST_EVENTS"
    case "$*" in
        'ci --omit=dev') [ "$TEST_FAIL" != dependencies ] ;;
        'ci --include=dev') [ "$TEST_FAIL" != frontend-dependencies ] ;;
        'run build -- --outDir '*)
            [ "$TEST_FAIL" != build ] || return 1
            local target
            while [ "$#" -gt 0 ]; do
                if [ "$1" = --outDir ]; then
                    shift
                    target="$1"
                fi
                shift
            done
            printf 'fork UI' > "$target/index.html"
            ;;
        *) printf 'Unexpected npm command: %s\n' "$*" >&2; return 99 ;;
    esac
}
pgrep() { return 0; }
sleep() { :; }
rsync() { return 1; }
create_symlink() { :; }
persist_install_path() { :; }
stop_service() { printf 'stop\n' >> "$TEST_EVENTS"; }
start_service() { printf 'start\n' >> "$TEST_EVENTS"; }
update_service
`
    })
    if (result.error) {
      throw result.error
    }
    return {
      ...result,
      events: fs.readFileSync(path.join(directory, 'events.log'), 'utf8').trim().split('\n'),
      ui: fs.readFileSync(path.join(directory, 'web/admin-spa/dist/index.html'), 'utf8')
    }
  }

  test('builds fork UI from the checkout before restarting, including dev dependencies', () => {
    const result = update()

    expect(result.status).toBe(0)
    expect(result.ui).toBe('fork UI')
    expect(result.events).toContain('git merge --ff-only FETCH_HEAD')
    expect(result.events).toContain('npm ci --include=dev')
    expect(result.events.some((event) => event.startsWith('git clone'))).toBe(false)
    expect(result.events.some((event) => event.startsWith('git ls-remote'))).toBe(false)
    expect(result.events.slice(-2)).toEqual(['start', 'git log -1 --oneline'])
    const buildIndex = result.events.findIndex((event) => event.startsWith('npm run build'))
    expect(result.events.indexOf('stop')).toBeGreaterThan(buildIndex)
    expect(fs.readFileSync(path.join(directory, 'web/admin-spa/dist/custom.txt'), 'utf8')).toBe(
      'custom file'
    )
    expect(fs.readFileSync(path.join(directory, '.env'), 'utf8')).toBe('NODE_ENV=production\n')
  })

  test.each(['dirty', 'staged', 'fetch', 'divergent', 'merge'])(
    'rejects %s before dependency changes or stopping the service',
    (failure) => {
      const result = update({ TEST_FAIL: failure })

      expect(result.status).toBe(1)
      expect(result.events).not.toContain('npm ci --omit=dev')
      expect(result.events).not.toContain('stop')
      expect(result.ui).toBe('existing UI')
      expect(result.events.some((event) => /git (stash|reset)/.test(event))).toBe(false)
      expect(result.stdout).not.toContain('更新完成！')
    }
  )

  test.each(['dependencies', 'frontend-dependencies', 'build'])(
    'reports %s failure while leaving the running service and served UI intact',
    (failure) => {
      const result = update({ TEST_FAIL: failure })

      expect(result.status).toBe(1)
      expect(result.events).not.toContain('stop')
      expect(result.events).not.toContain('start')
      expect(result.ui).toBe('existing UI')
      expect(result.stdout).not.toContain('更新完成！')
    }
  )

  test('downloads upstream artifacts using the exact configured origin URL', () => {
    const origin = 'git@github.com:Wei-Shaw/claude-relay-service.git'
    const result = update({ TEST_ORIGIN: origin })

    expect(result.status).toBe(0)
    expect(result.ui).toBe('downloaded UI')
    expect(result.events).not.toContain('npm ci --include=dev')
    expect(result.events.find((event) => event.startsWith('git clone'))).toContain(origin)
    expect(result.events.some((event) => event.includes('https://github.com/Wei-Shaw'))).toBe(false)
  })

  test('does not stop the service or remove served files when artifact download fails', () => {
    const result = update({
      TEST_ORIGIN: 'https://github.com/Wei-Shaw/claude-relay-service.git',
      TEST_FAIL: 'clone'
    })

    expect(result.status).toBe(1)
    expect(result.events).not.toContain('stop')
    expect(result.ui).toBe('existing UI')
    expect(result.stdout).not.toContain('更新完成！')
  })
})
