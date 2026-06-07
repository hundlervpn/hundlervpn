// Type-safe wrapper над xray.app.proxyman.command.HandlerService.
//
// Xray использует pattern "вложенный TypedMessage" для AlterInbound:
//
//   AlterInboundRequest {
//     tag: "vless-in"
//     operation: TypedMessage {
//       type:  "xray.app.proxyman.command.AddUserOperation"   ← OUTER type
//       value: <serialized AddUserOperation> {
//         user: User {
//           email: "tg-150-s12"
//           account: TypedMessage {
//             type:  "xray.proxy.vless.Account"  ← INNER type
//             value: <serialized vless.Account { id: "uuid", flow: "" }>
//           }
//         }
//       }
//     }
//   }
//
// Чтобы корректно сформировать оба уровня, мы сами сериализуем
// внутренние сообщения через proto-loader'овский `encode()` и пакуем
// их в bytes. Так делают все известные кастомные xray-клиенты
// (Marzban, x-ui, Remnawave). Динамический proto-loader делает это
// возможным без code-gen — сериализуется реальная схема загруженная
// из .proto файлов.

import * as path from 'node:path';
import { existsSync } from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as protobuf from 'protobufjs';
import { fileURLToPath } from 'node:url';

import { log } from './logger.ts';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface XrayClient {
  /** UUID, lowercase, dashed. */
  id: string;
  /** "" (XUDP) или "xtls-rprx-vision" (TCP Reality). Per-server. */
  flow: string;
  /** Unique email-label e.g. `tg-150-s12`, `u-200-k5`, `pool-7`. */
  email: string;
}

// ────────────────────────────────────────────────────────────────────────
// Proto loading — пути относительно скомпилированного бинаря
// ────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Proto-файлы — НЕ embed'ятся в bun --compile (он embed'ит только .ts),
// поэтому в production они должны быть доступны на диске рядом с бинарём.
//
// Resolution order:
//   1. ENV PROTO_ROOT — явное указание (для тестов/deploy override).
//   2. <execPath_dir>/proto — production: install-on-vps.sh кладёт
//      proto/ рядом с /opt/hundler-xray-agent.
//   3. <__dirname>/../proto — dev: bun run src/index.ts из agent/ дир.
//
// fs.existsSync на startup отсеивает несуществующие; первый найденный
// path выигрывает.
function resolveProtoRoot(): string {
  const candidates = [
    process.env.PROTO_ROOT,
    path.resolve(path.dirname(process.execPath), 'proto'),
    path.resolve(__dirname, '..', 'proto'),
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback: вернём dev-path и пусть proto-loader даст осмысленную ошибку
  // если ничего не нашлось — это лучше чем тихая success.
  return path.resolve(__dirname, '..', 'proto');
}

const PROTO_ROOT = resolveProtoRoot();

interface ProtoTypes {
  HandlerService: grpc.ServiceClientConstructor;
  // protobufjs.Type instances — у них настоящие .encode/.decode/.create.
  // Достаются через protobuf.Root.lookupType(fullName), НЕ через proto-loader.
  AddUserOperation: protobuf.Type;
  RemoveUserOperation: protobuf.Type;
  TypedMessage: protobuf.Type;
  VlessAccount: protobuf.Type;
}

let cachedTypes: ProtoTypes | null = null;

function loadProtos(): ProtoTypes {
  if (cachedTypes) return cachedTypes;

  // ── 1. gRPC service constructor через @grpc/proto-loader ─────────────
  // proto-loader строит ServiceDefinition (RPC methods, request/response
  // serializers) — именно это нужно gRPC client'у.
  const packageDefinition = protoLoader.loadSync(
    [
      'app/proxyman/command/command.proto',
      'common/protocol/user.proto',
      'common/serial/typed_message.proto',
      'proxy/vless/account.proto',
    ],
    {
      keepCase: true, // сохраняем snake_case (нам нужен isOnlyTags vs is_only_tags)
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_ROOT],
    },
  );
  const grpcRoot = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoRoot;
  const HandlerService = grpcRoot.xray.app.proxyman.command.HandlerService;

  // ── 2. Message types через protobufjs.Root напрямую ─────────────────
  // @grpc/proto-loader возвращает MessageTypeDefinition.type как
  // descriptor-POJO (toObject), у которого НЕТ .encode/.decode. Чтобы
  // получить настоящий protobufjs.Type с рабочей сериализацией —
  // загружаем те же .proto-файлы отдельно через protobufjs.loadSync.
  //
  // Это дублирует парсинг schema, но дёшево (~1-2 мс) и происходит один
  // раз при startup. Альтернатива — собирать .json descriptor через
  // pbjs CLI заранее — но добавит build-step и проблем с rebuild при
  // изменении .proto.
  const root = new protobuf.Root();
  // resolvePath чтобы import "common/serial/typed_message.proto" внутри
  // .proto файлов разрешался относительно PROTO_ROOT, а не cwd.
  root.resolvePath = (_origin, target) => {
    // Абсолютные пути возвращаем как есть.
    if (path.isAbsolute(target)) return target;
    return path.resolve(PROTO_ROOT, target);
  };
  root.loadSync(
    [
      path.join(PROTO_ROOT, 'app/proxyman/command/command.proto'),
      path.join(PROTO_ROOT, 'common/protocol/user.proto'),
      path.join(PROTO_ROOT, 'common/serial/typed_message.proto'),
      path.join(PROTO_ROOT, 'proxy/vless/account.proto'),
    ],
    { keepCase: true },
  );

  cachedTypes = {
    HandlerService,
    AddUserOperation: root.lookupType('xray.app.proxyman.command.AddUserOperation'),
    RemoveUserOperation: root.lookupType('xray.app.proxyman.command.RemoveUserOperation'),
    TypedMessage: root.lookupType('xray.common.serial.TypedMessage'),
    VlessAccount: root.lookupType('xray.proxy.vless.Account'),
  };

  log.debug('proto types loaded', {
    protoRoot: PROTO_ROOT,
    types: Object.keys(cachedTypes),
  });

  return cachedTypes;
}

// proto-loader returns a deeply nested object. We only typed the path
// we actually use; everything else is `unknown`.
interface ProtoRoot {
  xray: {
    app: {
      proxyman: {
        command: {
          HandlerService: grpc.ServiceClientConstructor;
        };
      };
    };
  };
}

// ────────────────────────────────────────────────────────────────────────
// Client
// ────────────────────────────────────────────────────────────────────────

export class XrayGrpcClient {
  private client: grpc.Client;
  private readonly types: ProtoTypes;

  constructor(target: string) {
    this.types = loadProtos();
    // insecure credentials — соединение идёт через 127.0.0.1, TLS не
    // нужен (mTLS overkill для localhost). Если когда-нибудь захотим
    // remote management, переключимся на grpc.credentials.createSsl.
    this.client = new this.types.HandlerService(target, grpc.credentials.createInsecure());
  }

  close(): void {
    this.client.close();
  }

  /**
   * Добавить клиента в существующий inbound. Идемпотентно НЕ является:
   * повторный AddUser для same email вернёт ошибку "User already exists".
   * Поэтому caller обязан считать дельту через listInboundUsers перед
   * batched apply'ем.
   */
  async addUser(inboundTag: string, client: XrayClient): Promise<void> {
    // Inner TypedMessage: VLESS Account → bytes.
    const vlessAccountBytes = this.types.VlessAccount.encode({
      id: client.id,
      flow: client.flow,
    }).finish();

    // Outer TypedMessage: AddUserOperation { User { account: TM(vless) } } → bytes.
    // protobufjs accepts nested POJO directly — никаких лишних decode-encode roundtrip.
    const addUserOpBytes = this.types.AddUserOperation.encode({
      user: {
        level: 0,
        email: client.email,
        account: {
          type: 'xray.proxy.vless.Account',
          value: vlessAccountBytes,
        },
      },
    }).finish();

    await this.alterInbound(inboundTag, {
      type: 'xray.app.proxyman.command.AddUserOperation',
      value: addUserOpBytes,
    });
  }

  /**
   * Удалить клиента по email-label. Xray ищет по email (не по UUID!),
   * поэтому label должен быть уникальным — что и так гарантировано
   * нашей DB-схемой (см. /api/xray/clients route comments).
   */
  async removeUser(inboundTag: string, email: string): Promise<void> {
    const removeUserOpBytes = this.types.RemoveUserOperation.encode({
      email,
    }).finish();

    await this.alterInbound(inboundTag, {
      type: 'xray.app.proxyman.command.RemoveUserOperation',
      value: removeUserOpBytes,
    });
  }

  /**
   * Получить список email-label'ов всех клиентов в inbound. Используется
   * для diff'а: знаем что сейчас в Xray, знаем что должно быть, считаем
   * add/remove. Возвращаем Set<string> (emails) — UUID gRPC не возвращает
   * для security, но нам и не нужно: уникальность гарантирована email'ом.
   */
  async listInboundUserEmails(inboundTag: string): Promise<Set<string>> {
    // GetInboundUsers с пустым email возвращает ВСЕХ пользователей
    // в указанном inbound (см. xray-core/proxy/proxyman/inbound/dynamic.go
    // implementation: empty email is treated as wildcard).
    const req = { tag: inboundTag, email: '' };

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.client as any).getInboundUsers(req, (err: Error | null, resp: { users?: Array<{ email: string }> }) => {
        if (err) {
          // Specific case: "handler not found" — inbound НЕ существует
          // в running Xray. Это значит config.json НЕ загружен правильно.
          // Возвращаем пустой Set чтобы caller увидел дельту = all-add
          // (попытка восстановить state).
          if (err.message.includes('not found') || err.message.includes('NotFound')) {
            log.warn('Inbound not registered in Xray', { inboundTag });
            resolve(new Set());
            return;
          }
          reject(err);
          return;
        }
        const emails = new Set<string>();
        for (const u of resp.users ?? []) {
          if (u.email) emails.add(u.email);
        }
        resolve(emails);
      });
    });
  }

  /**
   * Низкоуровневый AlterInbound. Принимает уже сериализованную operation
   * как TypedMessage (т.е. caller сам выбрал что это — AddUser/RemoveUser).
   */
  private alterInbound(
    inboundTag: string,
    operation: { type: string; value: Uint8Array },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = {
        tag: inboundTag,
        operation,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.client as any).alterInbound(req, (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}
