
import * as cdk from 'aws-cdk-lib';

export interface ProjectConfig {
    Name: string,
    Stage: string,
    Account: string,
    Region: string,
    Profile: string
}

export interface StackConfig {
    Name: string,
    UpdateRegionName?: string,
    [name: string]: any
}

export interface AppConfig {
    Project: ProjectConfig;
    Global: any;
    Stack: StackConfig;
}

export interface StackCommonProps extends cdk.StackProps {
    projectPrefix: string;
    appConfig: AppConfig;
    appConfigPath: string;
    variables: any;
}