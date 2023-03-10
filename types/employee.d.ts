/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/employee
 */
export interface Employee {
  Id: string;
  SyncToken?: string;
  PrimaryAddr?: {
    Id: string;
    PostalCode?: string;
    City?: string;
    Country?: string;
    Line5?: string;
    Line4?: string;
    Line3?: string;
    Line2?: string;
    Line1?: string;
    Lat?: string;
    Long?: string;
    CountrySubDivisionCode?: string;
  };
  PrimaryEmailAddr?: {
    Address?: string;
  };
  DisplayName?: string;
  Title?: string;
  BillableTime?: boolean;
  GivenName?: string;
  BirthDate?: {
    date?: string;
  };
  MiddleName?: string;
  SSN?: string;
  PrimaryPhone?: {
    FreeFormNumber?: string;
  };
  Active?: boolean;
  ReleasedDate?: {
    date?: string;
  };
  MetaData?: {
    CreateTime?: string;
    LastUpdatedTime?: string;
  };
  CostRate?: number;
  Mobile?: {
    FreeFormNumber?: string;
  };
  Gender?: string;
  HiredDate?: {
    date?: string;
  };
  BillRate?: number;
  Organization?: boolean;
  Suffix?: string;
  FamilyName?: string;
  PrintOnCheckName?: string;
  EmployeeNumber?: string;
  domain?: string;
  sparse?: boolean;
}
