
export interface RefreshAccessToken {
  access_token:               string;
  expires_in:                 number;
  x_refresh_token_expires_in: number;
  refresh_token:              string;
  token_type:                 string;
}
