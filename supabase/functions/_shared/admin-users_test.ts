import { describe, expect, it } from "vitest";

import {
  deleteAuthUser,
  findAuthUserIdByEmail,
  isEmailAlreadyRegisteredError
} from "./admin-users.ts";
import type { AuthUserGateway, AuthUserRef } from "./admin-users.ts";

function gateway(options: {
  deleteError?: unknown;
  userAfterDelete?: AuthUserRef | null;
}): AuthUserGateway & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    async deleteUser(userId: string) {
      deleted.push(userId);
      return { error: options.deleteError ?? null };
    },
    async getUserById() {
      return { user: options.userAfterDelete ?? null, error: null };
    }
  };
}

describe("deleteAuthUser", () => {
  it("exclui a conta quando o Auth responde sem erro", async () => {
    const auth = gateway({});

    await deleteAuthUser(auth, "user-1");

    expect(auth.deleted).toEqual(["user-1"]);
  });

  it("ignora o erro quando a conta realmente sumiu do Auth", async () => {
    const auth = gateway({ deleteError: { status: 404, message: "User not found" } });

    await expect(deleteAuthUser(auth, "user-1")).resolves.toBeUndefined();
  });

  it("propaga o erro quando a conta continua existindo", async () => {
    const auth = gateway({
      deleteError: { status: 404, message: "User not found" },
      userAfterDelete: { id: "user-1", email: "carregador@example.com" }
    });

    await expect(deleteAuthUser(auth, "user-1")).rejects.toEqual({
      status: 404,
      message: "User not found"
    });
  });

  it("propaga erros que nao sao de conta inexistente quando a conta sobrevive", async () => {
    const auth = gateway({
      deleteError: { status: 500, message: "Database error deleting user" },
      userAfterDelete: { id: "user-1" }
    });

    await expect(deleteAuthUser(auth, "user-1")).rejects.toMatchObject({ status: 500 });
  });
});

describe("findAuthUserIdByEmail", () => {
  const pages: Record<number, AuthUserRef[]> = {
    1: [
      { id: "a", email: "Alguem@Example.com" },
      { id: "b", email: "outro@example.com" }
    ],
    2: [{ id: "c", email: "carregador1@gmail.com" }],
    3: []
  };
  const listPage = async (page: number) => ({ users: pages[page] ?? [] });

  it("encontra na primeira pagina ignorando caixa e espacos", async () => {
    expect(await findAuthUserIdByEmail(listPage, "  alguem@example.com ")).toBe("a");
  });

  it("continua paginando ate achar", async () => {
    expect(await findAuthUserIdByEmail(listPage, "carregador1@gmail.com")).toBe("c");
  });

  it("devolve null quando o e-mail nao existe", async () => {
    expect(await findAuthUserIdByEmail(listPage, "ninguem@example.com")).toBeNull();
  });

  it("devolve null para e-mail vazio sem consultar o Auth", async () => {
    let calls = 0;
    const counted = async (page: number) => {
      calls++;
      return { users: pages[page] ?? [] };
    };

    expect(await findAuthUserIdByEmail(counted, "   ")).toBeNull();
    expect(calls).toBe(0);
  });

  it("respeita o limite de paginas", async () => {
    const infinite = async () => ({ users: [{ id: "x", email: "x@example.com" }] });

    expect(await findAuthUserIdByEmail(infinite, "carregador1@gmail.com", 3)).toBeNull();
  });
});

describe("isEmailAlreadyRegisteredError", () => {
  it("reconhece o code email_exists", () => {
    expect(isEmailAlreadyRegisteredError({ code: "email_exists" })).toBe(true);
  });

  it("reconhece a mensagem do GoTrue", () => {
    expect(
      isEmailAlreadyRegisteredError({
        message: "A user with this email address has already been registered"
      })
    ).toBe(true);
  });

  it("nao confunde com outros erros", () => {
    expect(
      isEmailAlreadyRegisteredError({ message: "Password should be at least 6 characters" })
    ).toBe(false);
    expect(isEmailAlreadyRegisteredError(null)).toBe(false);
    expect(isEmailAlreadyRegisteredError("erro")).toBe(false);
  });
});
