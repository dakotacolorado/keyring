import { KeyringApi } from "./api.ts";
import { buildOf, PACKAGE_VERSION } from "./build.ts";
import { Keyring } from "./service.ts";
import { Store } from "./store.ts";

export interface Config {
  /** The SQLite database; `:memory:` keeps nothing past the process. */
  db: string;
  /** The master key every value is sealed under. */
  key: Buffer;
  /** A token named `admin`, beside those in the database. */
  adminToken: string | null;
}

export interface Running {
  api: KeyringApi;
  keyring: Keyring;
  store: Store;
  close(): void;
}

/** The API over the database at `config.db`, opened with `config.key`; throws when the key is not the database's. */
export function start(config: Config): Running {
  const store = Store.open(config.db);
  try {
    const keyring = new Keyring(store, config.key);
    const api = new KeyringApi(keyring, { version: PACKAGE_VERSION, commit: buildOf().commit }, { adminToken: config.adminToken });
    return { api, keyring, store, close: () => store.close() };
  } catch (err) {
    store.close();
    throw err;
  }
}
