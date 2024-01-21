const fs = require('fs');
const env = require('env-var');
import * as cdk from 'aws-cdk-lib';

import { AppConfig, StackCommonProps } from './app-config';


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

export class AppContext {
    public readonly cdkApp: cdk.App;
    public readonly appConfig: AppConfig;
    public readonly stackCommonProps: StackCommonProps;

    private readonly appContextProps: AppContextProps;

    constructor(props: AppContextProps) {
        this.cdkApp = new cdk.App();
        this.appContextProps = props;

        try {
            const appConfigFile = this.findAppConfigFile(props.appConfigFileKey);

            this.appConfig = this.loadAppConfigFile(appConfigFile, props.contextArgs);

            if (this.appConfig != undefined) {
                this.stackCommonProps = this.createStackCommonProps(appConfigFile);
            }

        } catch (e) {
            console.error(`==> CDK App-Config File is empty, 
            set up your environment variable(Usage: export ${props.appConfigFileKey}=config/app-config-xxx.json) 
            or append inline-argurment(Usage: cdk list --context ${props.appConfigFileKey}=config/app-config-xxx.json)`, e);
            throw new AppContextError('Fail to find App-Config json file');
        }
    }

    public ready(): boolean {
        return this.stackCommonProps ? true : false;
    }

    private createStackCommonProps(appConfigFile: string): StackCommonProps {
        const stackProps: StackCommonProps = {
            projectPrefix: this.getProjectPrefix(this.appConfig.Project.Name, this.appConfig.Project.Stage),
            appConfig: this.appConfig,
            appConfigPath: appConfigFile,
            env: {
                account: this.appConfig.Project.Account,
                region: this.appConfig.Project.Region
            },
            variables: {}
        }

        return stackProps;
    }

    private findAppConfigFile(appConfigKey: string): string {
        let fromType = 'InLine-Argument';
        let configFilePath = this.cdkApp.node.tryGetContext(appConfigKey);

        if (configFilePath == undefined) {
            configFilePath = env.get(appConfigKey).asString();

            if (configFilePath != undefined && configFilePath.length > 0) {
                fromType = 'Environment-Variable';
            } else {
                configFilePath = undefined;
            }
        }

        if (configFilePath == undefined) {
            throw new Error('Fail to find App-Config json file')
        } else {
            console.info(`==> CDK App-Config File is ${configFilePath}, which is from ${fromType}.`);
        }

        return configFilePath;
    }

    private getProjectPrefix(projectName: string, projectStage: string): string {
        let prefix = `${projectName}${projectStage}`;

        if (this.appContextProps.projectPrefixType === ProjectPrefixType.NameHyphenStage) {
            prefix = `${projectName}-${projectStage}`;
        } else if (this.appContextProps.projectPrefixType === ProjectPrefixType.Name) {
            prefix = projectName;
        }

        return prefix;
    }

    private loadAppConfigFile(filePath: string, contextArgs?: string[]): any {
        let appConfig = JSON.parse(fs.readFileSync(filePath).toString());
        let projectPrefix = this.getProjectPrefix(appConfig.Project.Name, appConfig.Project.Stage);

        if (contextArgs != undefined) {
            this.updateContextArgs(appConfig, contextArgs);
        }

        this.addPrefixIntoStackName(appConfig, projectPrefix);

        return appConfig;
    }

    private updateContextArgs(appConfig: any, contextArgs: string[]) {
        for (let key of contextArgs) {
            const jsonKeys = key.split('.');
            let oldValue = undefined;
            const newValue: string = this.cdkApp.node.tryGetContext(key);
    
            if (newValue != undefined && jsonKeys.length > 0) {
                try {
                    oldValue = jsonKeys.reduce((reducer: any, pointer: string) => reducer.hasOwnProperty(pointer) ? reducer[pointer] : undefined, appConfig);
                } catch(e) {
                    console.error(`[ERROR] updateContextArgs: This key[${key}] is an undefined value in Json-Config file.\n`, e);
                    throw e;
                }
    
                jsonKeys.reduce((reducer: any, pointer: string, count: number) => {
                    if (count == jsonKeys.length - 1) reducer[pointer] = newValue;
                    return reducer[pointer];
                }, appConfig);
    
                console.info(`[INFO] updateContextArgs: Updated ${key} = ${oldValue}-->${newValue}`);
            }
        }
    }

    private addPrefixIntoStackName(appConfig: any, projectPrefix: string) {
        for (const key in appConfig.Stack) {
            const stackOriginalName = appConfig.Stack[key].Name;
            appConfig.Stack[key].ShortStackName = stackOriginalName;
            appConfig.Stack[key].Name = `${projectPrefix}-${stackOriginalName}`;
        }
    }
}
