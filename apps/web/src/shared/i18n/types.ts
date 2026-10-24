import type { enMessages } from "./en";

export type Locale = "en";

type MessageValue = string | ((params: any) => string);

type CatalogShape<T extends Record<string, MessageValue>> = {
  [K in keyof T]: T[K] extends (params: infer P) => string ? (params: P) => string : string;
};

export type I18nMessages = CatalogShape<typeof enMessages>;

type FunctionMessageKey = {
  [K in keyof I18nMessages]: I18nMessages[K] extends (params: any) => string ? K : never;
}[keyof I18nMessages];

type StringMessageKey = Exclude<keyof I18nMessages, FunctionMessageKey>;

type MessageParams<K extends FunctionMessageKey> = I18nMessages[K] extends (params: infer P) => string ? P : never;

export type Translate = {
  <K extends StringMessageKey>(key: K): string;
  <K extends FunctionMessageKey>(key: K, params: MessageParams<K>): string;
};
