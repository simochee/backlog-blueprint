import { type ResourceKind } from "./resource";

export type Ref = { $ref: { kind: ResourceKind; name: string } };

export type Value = string | number | boolean | null | Ref | Value[];

export type ResolvedValue = string | number | boolean | null | ResolvedValue[];

export type IdOrRef = number | Ref;
