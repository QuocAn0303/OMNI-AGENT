import { Component } from 'react';
import { Button, Result } from 'antd';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="500"
          title="Đã xảy ra lỗi"
          subTitle="Một lỗi không mong muốn đã xảy ra khi tải trang này. Vui lòng thử lại."
          extra={[
            <Button key="retry" type="primary" onClick={this.handleReset}>
              Thử lại
            </Button>,
            <Button key="home" onClick={() => { this.handleReset(); window.location.href = '/dashboard'; }}>
              Về trang chủ
            </Button>,
          ]}
        />
      );
    }
    return this.props.children;
  }
}
