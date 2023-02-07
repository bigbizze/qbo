

import { CompanyInfo } from './company-info';
import { Customer } from './customer';
import { CustomerType } from './customer-type';
import { Employee } from './employee';
import { UserInfo } from "./user-info";
import { RefreshAccessToken } from "./refresh-access-token";

export type Get<T> = {
  time: Date,
  timeStr: string,
  data: T
};

export type Find<T> = {
  time: Date;
  timeStr: string,
  startPosition: number;
  maxResults:    number;
  data: T[]
}

export type Update<T> = Omit<Omit<T, "Id">, "SyncToken"> & {
  Id: string,
  SyncToken: string
}

export interface QueryCriteria {
  fetchAll?: boolean,
  limit?: number,
  offset?: number,
}
export interface NewQuickBooksInstanceSettings {
  clientId: string,
  clientSecret: string,
  accessToken: string,
  refreshToken: string,
  realmId: string,
  useSandbox: boolean,
  debug: boolean,
  minorVersion?: string
}
export default class QuickBooks {
  static new(settings: NewQuickBooksInstanceSettings): Promise<QuickBooks>;
  refreshAccessToken(): Promise<RefreshAccessToken>;
  revokeAccess(useRefresh: boolean): Promise<void>;
  getUserInfo(): Promise<UserInfo>;
  getCompanyInfo(id: string): Promise<Get<CompanyInfo>>;
  findCompanyInfo(criteria: QueryCriteria): Promise<Find<CompanyInfo>>;
  updateCompanyInfo(companyInfo: Update<CompanyInfo>): Promise<Get<CompanyInfo>>;
  getCustomer(id: string): Promise<Get<Customer>>;
  findCustomers(criteria: QueryCriteria): Promise<Find<Customer>>;
  updateCustomer(customer: Update<Customer>): Promise<Get<Customer>>;
  getCustomerType(id: string): Promise<Get<CustomerType>>;
  findCustomerTypes(criteria: QueryCriteria): Promise<Find<CustomerType>>;
  getEmployee(id: string): Promise<Get<Employee>>;
  findEmployees(criteria: QueryCriteria): Promise<Find<Employee>>;
  updateEmployee(employee: Update<Employee>): Promise<Get<Employee>>;
}
