import type { Logger } from "../log";
import type { UserRepo } from "./repo";
import type { User, UserPatch } from "./types";

export class UserService {
  constructor(
    private readonly repo: UserRepo,
    private readonly log: Logger,
  ) {}

  async getUser(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }

  async updateUser(id: string, patch: UserPatch): Promise<User | null> {
    const user = await this.repo.update(id, patch);
    if (user) this.log.info("user updated", { id });
    return user;
  }

  async teamOf(id: string): Promise<User[]> {
    const user = await this.getUser(id);
    return user ? this.repo.findByTeam(user.teamId) : [];
  }
}
