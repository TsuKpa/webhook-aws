
import * as cdk from 'aws-cdk-lib';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { DatabaseInstanceEngine } from 'aws-cdk-lib/aws-rds';

export enum DBType {
    POSTGRES = 'POSTGRES',
    MYSQL = 'MYSQL'
}

export interface ProjectConfig {
    name: string,
    stage: string,
    account: string,
    region: string,
    profile: string
}

enum CacheEngine {
    REDIS = 'redis',
    MEMCACHED = 'memcached'
}

export const RDSEngine = {
    [DBType.POSTGRES]: DatabaseInstanceEngine.POSTGRES,
    [DBType.MYSQL]: DatabaseInstanceEngine.MYSQL
}

export class AppContextError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AppConfigFileFailError";
    }
}

export enum ProjectPrefixType {
    NameStage,
    NameHyphenStage,
    Name
}

export interface AppContextProps {
    appConfigFileKey: string;
    contextArgs?: string[];
    projectPrefixType?: ProjectPrefixType;
}

export type ParameterType = {
    name: string;
    value: string;
}

export interface StackConfig {
    webhookECS: {
        name: string;
        description: string;
        vpc: {
            name: string;
            maxAZs: number;
            cidr: string;
            natGatewayCount: number;
            subnetConfiguration: {
                cidrMask: number;
                name: string;
                subnetType: SubnetType,
            }[];
        };
        elasticCache: {
            name: string;
            engine: CacheEngine;
            cacheNodeType: string;
            numCacheNodes: number;
        };
        rds: {
            name: string;
            engine: DBType;
            allocatedStorage: number;
            credentials: {
                username: string;
                password: string;
            }
        };
        ecr: {
            repositoriesName: string[];
        };
        ecs: {
            clusterName: string;
            services: {
                name: string;
                taskDefinitions: any;
            }[];
        };
        ssmParameter: {
            redis: {
                host: ParameterType;
                maxJob: ParameterType;
                maxJobDuration: ParameterType;
            };
            rds: {
                host: ParameterType;
                databaseUrl: ParameterType
            }
        };
        logs: {
            logGroupNames: string[];
            retention: RetentionDays;
        };
    };
    [key: string]: any;
}

export interface AppConfig {
    project: ProjectConfig;
    global: any;
    stacks: StackConfig;
}

export interface StackCommonProps extends cdk.StackProps {
    projectPrefix: string;
    appConfig: AppConfig;
    appConfigPath: string;
    variables: any;
}