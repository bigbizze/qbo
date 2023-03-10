/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
 */
export interface Customer {
  Id: string;
  SyncToken?: string;
  DisplayName?: string;
  Title?: string;
  GivenName?: string;
  MiddleName?: string;
  Suffix?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: {
    Address?: string;
  };
  ResaleNum?: string;
  SecondaryTaxIdentifier?: string;
  ARAccountRef?: {
    value: string;
    name?: string;
  };
  DefaultTaxCodeRef?: {
    value: string;
    name?: string;
  };
  PreferredDeliveryMethod?: string;
  GSTIN?: string;
  SalesTermRef?: {
    value: string;
    name?: string;
  };
  CustomerTypeRef?: {
    value: string;
  };
  Fax?: {
    FreeFormNumber?: string;
  };
  BusinessNumber?: string;
  BillWithParent?: boolean;
  CurrencyRef?: {
    value: string;
    name?: string;
  };
  Mobile?: {
    FreeFormNumber?: string;
  };
  Job?: boolean;
  BalanceWithJobs?: number;
  PrimaryPhone?: {
    FreeFormNumber?: string;
  };
  OpenBalanceDate?: {
    date?: string;
  };
  Taxable?: boolean;
  AlternatePhone?: {
    FreeFormNumber?: string;
  };
  MetaData?: {
    CreateTime?: string;
    LastUpdatedTime?: string;
  };
  ParentRef?: {
    value: string;
    name?: string;
  };
  Notes?: string;
  WebAddr?: {
    URI?: string;
  };
  Active?: boolean;
  CompanyName?: string;
  Balance?: number;
  ShipAddr?: {
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
  PaymentMethodRef?: {
    value: string;
    name?: string;
  };
  IsProject?: boolean;
  Source?: string;
  PrimaryTaxIdentifier?: string;
  GSTRegistrationType?: string;
  PrintOnCheckName?: string;
  BillAddr?: {
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
  FullyQualifiedName?: string;
  Level?: number;
  TaxExemptionReasonId?: number;
  domain?: string;
  sparse?: boolean;
}
