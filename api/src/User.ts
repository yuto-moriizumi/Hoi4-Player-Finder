export default interface User {
  // 基本ユーザ構造
  id: string;
  tweet_id: string;
  content: string;
  created_at: string;
  name: string;
  screen_name: string;
  img_url: string;
}

export interface CachedUser extends User {
  // DB内部のユーザデータ
  cached_at: string;
}

export interface TwitterResponseUser {
  // TwitterAPIが返却する型
  id_str: string; // Twitter内部で管理しているユーザID
  name: string;
  screen_name: string; // Twitterのレスポンスにおけるscreen_nameで、いわゆる変更できるIDのこと
  profile_image_url_https: string;
}
