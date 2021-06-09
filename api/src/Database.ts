import mysql2 from 'mysql2/promise';
import User from './User';

export default class Database {
  private config: mysql2.ConnectionOptions;

  private connection?: mysql2.Connection;

  constructor(config: mysql2.ConnectionOptions) {
    this.config = config;
  }

  async updateUsers(users: User[], cached_at: string) {
    if (this.connection === undefined)
      this.connection = await mysql2.createConnection(this.config);
    const con = this.connection;
    users.forEach((user) => {
      con.execute(
        `UPDATE users SET name=?, screen_name=?, img_url=?, cached_at=? WHERE id=?`,
        [user.name, user.screen_name, user.img_url, cached_at, user.id]
      );
    });
    con.end();
  }
}
