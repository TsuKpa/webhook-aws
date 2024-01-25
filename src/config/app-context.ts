import * as fs from 'fs';
import * as env from 'env-var';
import * as cdk from 'aws-cdk-lib';

import { AppConfig, AppContextError, AppContextProps, ProjectPrefixType, StackCommonProps } from './app-config.interface';

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
            projectPrefix: this.getProjectPrefix(this.appConfig.project.name, this.appConfig.project.stage),
            appConfig: this.appConfig,
            appConfigPath: appConfigFile,
            env: {
                account: this.appConfig.project.account,
                region: this.appConfig.project.region
            },
            variables: {}
        }

        return stackProps;
    }

    private findAppConfigFile(appConfigKey: string): string {
        let fromType = 'InLine-Argument';
        let configFilePath = this.cdkApp.node.tryGetContext(appConfigKey);

        if (!configFilePath) {
            configFilePath = env.get(appConfigKey).asString();

            if (configFilePath && configFilePath.length) {
                fromType = 'Environment-Variable';
            } else {
                configFilePath = undefined;
            }
        }

        if (!configFilePath) {
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
        let appConfig: AppConfig = JSON.parse(fs.readFileSync(filePath).toString());
        let projectPrefix = this.getProjectPrefix(appConfig.project.name, appConfig.project.stage);

        if (contextArgs) {
            this.updateContextArgs(appConfig, contextArgs);
        }
        return appConfig;
    }

    private updateContextArgs(appConfig: AppConfig, contextArgs: string[]) {
        for (let key of contextArgs) {
            const jsonKeys = key.split('.');
            let oldValue;
            const newValue: string = this.cdkApp.node.tryGetContext(key);
    
            if (newValue && jsonKeys.length) {
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
}
